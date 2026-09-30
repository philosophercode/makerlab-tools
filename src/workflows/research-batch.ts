import { RESEARCH_CONCURRENCY } from "../lib/intake/limits.ts";
import type { ResearchFocusField } from "../lib/intake/research-focus.ts";
import { completeWithoutImages, findImages } from "../lib/research/image-steps.ts";
import type { ItemStepResult } from "../lib/research/step-types.ts";
import { completeFocusedItem, finishBatch, markItemFailed, readAndVerifyItem, searchItem } from "../lib/research/steps.ts";

/**
 * `researchBatch` — background research for the items one Research press sent
 * (spec §3.7, §5.4 step 9; resized by the 2026-09-22 amendment).
 *
 * Started only by `POST /api/pending-tools/research`, as
 * `start(researchBatch, [requestId, itemIds, reviewerNote])`. `reviewerNote` is
 * the optional instruction a reviewer typed beside **Research again** (one
 * item only — the route refuses a note on a batch); both model steps see it,
 * fenced, and the result records it. The items arrive already
 * `queued`; each ends `researched` or `failed` **independently** — one item
 * the provider refuses, or that times out three times, is marked failed with
 * its reason and the rest carry on.
 *
 * **Three at a time, in fixed chunks.** The body is a workflow function: it is
 * replayed from the run's event log after every step, and a replay must issue
 * the same step calls in the same order. So it is `chunk` + `Promise.allSettled`
 * over the chunk, which depends only on `itemIds`. `mapWithConcurrency`
 * (`capabilities/intake.ts`) must not be used here: it is a shared-cursor
 * worker pool whose order depends on which call finishes first, and a replay
 * would diverge (the amendment). Nothing here reads the clock or draws a random
 * number, for the same reason; the steps do all of that.
 *
 * **Three steps per item** (gateway spec §3.5), each with its own 240-second
 * deadline and retries:
 *
 * 1. `searchItem` — claim the row, then search with Exa: what the item is, which
 *    pages to read, and the images Exa saw.
 * 2. `readAndVerifyItem` — our server reads those pages (or, for one it cannot
 *    open, the search's copy of its text), the read model drafts
 *    the record, the links are verified. The draft comes back **unwritten**,
 *    with the product images the pages declared.
 * 3. `findImages` — probe, rank and clean the images, then write the item. If it
 *    gives up, `completeWithoutImages` writes the same draft with no images and
 *    the reason: **the image stage never fails an item**, only search and read
 *    can.
 *
 * **A scoped redo** (amendment "Guided redo"): `focus`, the fourth argument,
 * names the fields a reviewer's **Research again** asked for — one item only,
 * like the note. Search and read run as always, told the focus; the write then
 * merges only those fields into the stored result (`completeResearch`). With
 * the image among them, the image stage runs and its pictures replace the
 * stored ones; without it, `completeFocusedItem` writes the merge and no
 * picture is looked for. Absent (every run started before focus existed, and
 * every "everything") is exactly the flow above. An image-only focus never
 * starts this workflow: it is **Find a different image** (`image-retry.ts`).
 *
 * Everything that touches the database, the model or the network is a step in
 * `src/lib/research/steps.ts` or `image-steps.ts`.
 */
export async function researchBatch(
  requestId: string,
  itemIds: string[],
  reviewerNote: string | null = null,
  focus: ResearchFocusField[] | null = null
): Promise<{ researched: number; failed: number }> {
  "use workflow";
  let researched = 0;
  let failed = 0;
  let skipped = 0;

  for (const group of chunk(itemIds, RESEARCH_CONCURRENCY)) {
    const settled = await Promise.allSettled(
      group.map((id) => (focus ? researchFocused(id, requestId, reviewerNote, focus) : researchOne(id, requestId, reviewerNote)))
    );
    for (let i = 0; i < group.length; i += 1) {
      const outcome = settled[i];
      if (outcome.status === "fulfilled") {
        if (outcome.value === "researched") researched += 1;
        else skipped += 1;
        continue;
      }
      failed += 1;
      try {
        await markItemFailed(group[i], requestId, failureMessage(outcome.reason));
      } catch {
        // The row could not be written even after the step's retries. Leave it
        // and research the rest: one unwritable row must not strand the batch.
      }
    }
  }

  await finishBatch(requestId, { researched, failed, skipped });
  return { researched, failed };
}

/**
 * One item, three steps. A plain function in workflow scope, not a step. Every
 * step carries `requestId`, so each writes only while the row is still this
 * run's to write. The `try` around the image stage is ordinary control flow a
 * replay repeats exactly: the step's outcome, thrown or returned, is in the
 * event log.
 */
async function researchOne(id: string, requestId: string, reviewerNote: string | null): Promise<"researched" | "skipped"> {
  const search = await searchItem(id, requestId, reviewerNote);
  if (search.skip) return "skipped";
  const read = await readAndVerifyItem(id, requestId, search.findings, reviewerNote, search.searchTexts ?? []);
  if (read.outcome === "skipped") return "skipped";

  let written: ItemStepResult;
  try {
    written = await findImages(id, requestId, read.result, [...read.imageHints, ...search.exaImages]);
  } catch (error) {
    written = await completeWithoutImages(id, requestId, read.result, failureMessage(error));
  }
  return written.outcome;
}

/**
 * One item, redone in part: the same search and read, told the focus, then the
 * image stage only when the image is focused — otherwise the merge is written
 * straight away. Its own function, so an unscoped run's step calls stay exactly
 * what they were (a replay of a run started before focus existed must match).
 */
async function researchFocused(
  id: string,
  requestId: string,
  reviewerNote: string | null,
  focus: ResearchFocusField[]
): Promise<"researched" | "skipped"> {
  const search = await searchItem(id, requestId, reviewerNote, focus);
  if (search.skip) return "skipped";
  const read = await readAndVerifyItem(id, requestId, search.findings, reviewerNote, search.searchTexts ?? [], focus);
  if (read.outcome === "skipped") return "skipped";

  let written: ItemStepResult;
  if (!focus.includes("image")) {
    written = await completeFocusedItem(id, requestId, read.result, focus);
    return written.outcome;
  }
  try {
    written = await findImages(id, requestId, read.result, [...read.imageHints, ...search.exaImages], focus);
  } catch (error) {
    written = await completeWithoutImages(id, requestId, read.result, failureMessage(error), focus);
  }
  return written.outcome;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * What `research_error` will say. The steps throw classified errors whose
 * message is already written for that column (`research/errors.ts`). Read by
 * shape rather than `instanceof Error`: the workflow body runs in its own VM
 * context, whose `Error` is not the host's.
 */
function failureMessage(reason: unknown): string {
  const message = typeof reason === "object" && reason !== null ? (reason as { message?: unknown }).message : reason;
  if (typeof message === "string" && message) return message;
  return "Research failed for an unknown reason.";
}
