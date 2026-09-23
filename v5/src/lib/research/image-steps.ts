import { completeResearch, getPendingTool, type PendingTool } from "../data/pending-tools.ts";
import { hasUploadedPhoto, releaseCleanedImages } from "../data/research-images.ts";
import { getDb } from "../db/client.ts";
import type { Db } from "../db/types.ts";
import { IMAGE_STEP_MAX_RETRIES, IMAGE_STEP_TIMEOUT_MS, RESEARCH_STEP_MAX_RETRIES } from "../intake/limits.ts";
import type { ImageHint } from "../web/read-page.ts";
import { errorName, imageErrorText, rankAndClean, type StageOutcome } from "./image-stage.ts";
import { collectCandidates } from "./images/candidates.ts";
import type { ResearchResult } from "./result.ts";
import type { ItemStepResult } from "./step-types.ts";

// Nothing but steps is exported from here — not even a re-export of a pure
// helper. A workflow bundle keeps every export of a step module and everything
// those reach, and `image-stage.ts` reaches the SSRF-guarded fetch, Blob and the
// database, none of which a workflow function may import. Import helpers from
// `image-stage.ts` directly.


/**
 * The research workflow's third step: the product image finder (gateway spec
 * §3.5, §5.1 step 3), and the fallback that writes an item without it.
 *
 * {@link findImages} takes the result the read step drafted (not yet written)
 * and the image hints the pages and Exa gave, and writes the item —
 * `researching` → `researched` — with `research.images` filled in:
 *
 * 1. **Skipped** when the item owns a photo the admin uploaded: that photo is
 *    the cover, and nothing is spent (`images: null`, no error).
 * 2. **Candidates** — page metadata images first, then the pages' JSON-LD and
 *    gallery pictures in turn, Exa only as a top-up, at most 10, size variants
 *    of one picture counted once.
 * 3. **Probe** — each downloaded through the SSRF guard, kept in memory only if
 *    it decodes as JPEG/PNG/WebP with a short edge of 400 px, and its
 *    background classified (`transparent` / `plain` / `busy`). Nothing is
 *    stored. None left is a normal outcome: `{ candidates: [], cleaned: null }`.
 * 4. **Rank** — the `imageRank` model orders at most eight, told each one's
 *    background, and a clean background wins a close call; it also marks
 *    composites (banners, overlays, collages) and boxes the product, and
 *    composites go below every plain photo. The top three are recorded with
 *    its reasons, their backgrounds and a `composite` flag.
 * 5. **Clean** — rank 1 only, only when there is a Blob store to keep the copy
 *    in (`images/clean-copy.ts`). With a product box and a composite, a busy
 *    background or a small product, rank 1 is **cropped** to the box, then cut
 *    when the crop's backdrop is plain (`kind: "cropped_and_cut"`) or kept as a
 *    crop alone (`kind: "cropped"`). Otherwise a `plain` rank 1 gets a
 *    **deterministic cutout** (`images/clean.ts`). Every copy keeps the
 *    original's pixels — never a generative redraw. A `transparent` rank 1
 *    needs none: the original is the clean version, and `cleaned` stays null.
 *    The copy is stored **private** under `research/cleaned/`, owned by the
 *    pending item. A `busy` rank 1 with no box, or a cut that fails its
 *    checks, leaves `cleaned: null` with a `cleanNote` saying why; the
 *    candidates are still recorded.
 *
 * **Failure never fails the item** (§3.5). A ranking the model got wrong, a
 * model or Gateway failure, a timeout: each is caught here and recorded as a
 * one-line `imageError` with `images: null`. Only what nobody expected — the
 * database, a bug — escapes, so the step's own retry can have another go; and
 * when those run out the workflow calls {@link completeWithoutImages}, which
 * writes the item without images and says why. The item ends `researched`
 * either way.
 *
 * **Writes are this run's only** (§8 "Write safety"): both steps first check
 * that the row is still `researching` under this request id, and
 * `completeResearch` checks again as it writes. Each starts by releasing any
 * cleaned copy the item already holds — an earlier attempt's, or an earlier
 * research's — so the item never ends up with two.
 *
 * Plain Node: step code. Relative imports only, no `"server-only"` below here.
 */

/**
 * Step 3: find the item's product image and write the item. `hints` is every
 * hint the earlier steps found, the read pages' and Exa's together; they are
 * told apart by `source`.
 */
export async function findImages(
  id: string,
  requestId: string,
  result: ResearchResult,
  hints: ImageHint[]
): Promise<ItemStepResult> {
  "use step";
  try {
    return await findImagesFor(id, requestId, result, hints);
  } catch (error) {
    // Whatever escapes is unexpected — the database, a bug. Say which kind
    // without quoting it (a query error carries its SQL and parameters), and
    // let the step retry.
    throw new Error(`The image search failed unexpectedly (${errorName(error)}).`, { cause: error });
  }
}
findImages.maxRetries = IMAGE_STEP_MAX_RETRIES;

/**
 * The fallback when {@link findImages} gave up: the drafted result, written
 * with `images: null` and `reason` as `imageError`, clipped and scrubbed. The
 * item is `researched` — a machine without a found photo is a normal outcome.
 */
export async function completeWithoutImages(
  id: string,
  requestId: string,
  result: ResearchResult,
  reason: string
): Promise<ItemStepResult> {
  "use step";
  if (!(await stillResearching(id, requestId))) return { outcome: "skipped" };
  const db = await getDb();
  await releaseCleanedImages(db, id);
  return write(db, id, requestId, { ...result, images: null, imageError: imageErrorText(reason) });
}
completeWithoutImages.maxRetries = RESEARCH_STEP_MAX_RETRIES;

async function findImagesFor(
  id: string,
  requestId: string,
  result: ResearchResult,
  hints: readonly ImageHint[]
): Promise<ItemStepResult> {
  const item = await stillResearching(id, requestId);
  if (!item) return { outcome: "skipped" };

  const db = await getDb();
  await releaseCleanedImages(db, id);

  const outcome: StageOutcome = (await hasUploadedPhoto(db, id))
    ? { images: null, imageError: null }
    : await runStage(db, id, { name: result.canonicalName.trim() || item.name, brand: item.brand }, hints);

  return write(db, id, requestId, { ...result, images: outcome.images, imageError: outcome.imageError });
}

async function runStage(
  db: Db,
  id: string,
  subject: { name: string; brand: string | null },
  hints: readonly ImageHint[]
): Promise<StageOutcome> {
  const signal = AbortSignal.timeout(IMAGE_STEP_TIMEOUT_MS);

  // The brand's product page's pictures lead, manual and wiki pictures trail
  // (amendment "Product-page first, front-facing images").
  const candidates = collectCandidates(
    hints.filter((hint) => hint.source !== "exa"),
    hints.filter((hint) => hint.source === "exa"),
    subject
  );
  return rankAndClean(db, id, subject.name, candidates, { signal });
}

/** Store the result, or — the row was taken away meanwhile — let go of what this attempt made. */
async function write(db: Db, id: string, requestId: string, next: ResearchResult): Promise<ItemStepResult> {
  const stored = await completeResearch(id, next, { requestId });
  if (!stored) {
    await releaseCleanedImages(db, id);
    return { outcome: "skipped" };
  }
  return { outcome: "researched", confidence: next.confidence.level };
}

/** The row, while it is still `researching` under this run's request id. */
async function stillResearching(id: string, requestId: string): Promise<PendingTool | null> {
  const item = await getPendingTool(id);
  return item?.status === "researching" && item.researchRequestId === requestId ? item : null;
}

