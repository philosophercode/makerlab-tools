import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import {
  listPendingTools,
  markReadyAsUnit,
  markRedoRequest,
  queueForResearchWithinAllowance,
  recordStartFailure,
  setWorkflowRun,
  type PendingTool,
} from "../../../../lib/data/pending-tools";
import { isUuid } from "../../../../lib/data/uuid";
import { canActOnPendingTool, hasUnresolvedDuplicate, isResearchable } from "../../../../lib/intake/access";
import { requestImageRetry } from "../../../../lib/intake/image-retry";
import { imageRetryInProgress } from "../../../../lib/intake/image-retry-state";
import {
  RESEARCH_DAILY_ITEM_LIMIT,
  RESEARCH_MAX_ITEMS_PER_REQUEST,
  REVIEWER_NOTE_MAX_CHARS,
} from "../../../../lib/intake/limits";
import { isImageOnlyFocus, parseResearchFocus } from "../../../../lib/intake/research-focus";
import { parseReviewerNote } from "../../../../lib/intake/reviewer-note";
import type {
  PendingApiError,
  PendingApiErrorCode,
  ResearchStartedResponse,
} from "../../../../lib/intake/types";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { researchBatch } from "../../../../workflows/research-batch";

/**
 * `POST /api/pending-tools/research` — the **Research selected (N)** button
 * (spec §5.4 step 6).
 *
 * Starting research is a button press handled here, not a tool call (§3.6), so
 * the model never spends research budget on its own initiative. The route
 * checks, moves the rows, starts the workflow and returns; the research itself
 * happens in `researchBatch`, minutes later, and the card points at
 * `/admin/intake` for the results.
 *
 * **Every check runs before anything moves.** Identity, the limiter, sign-in,
 * `tools.add`; then every item must exist, be the caller's (or the caller
 * holds `tools.approve`), have its duplicate decided and be researchable; then
 * the day's allowance. A request that fails any of them changes no row — a
 * partial queue would leave the card showing items as waiting that nobody
 * started.
 *
 * **The allowance is one decision with the queueing.** It counts research
 * *presses* per person from the `research_requests` ledger — so researching the
 * same items again costs again — and the count and the move happen in one
 * transaction under a per-person lock (`queueForResearchWithinAllowance`), so
 * simultaneous presses cannot each see the same count and together pass it.
 *
 * **Add-unit items skip research** (§5.4 step 8): they become `researched`
 * straight away and cost nothing against the allowance. The rest are queued
 * and handed to one workflow run.
 *
 * **Nothing moved is never "done".** When the items passed every check and yet
 * none of them moved — a press that raced another for them — the answer is
 * `not_researchable` with their ids, not a success that started nothing.
 *
 * **When `start()` throws, the route says so** (§5.4 unhappy paths). The items
 * stay `queued` with the reason in `research_error`, the answer is 502
 * `start_failed` with their ids, and the same POST again is the Retry: a
 * queued item with a recorded start failure is researchable, and nothing else
 * about it changed.
 *
 * **A guided redo** (amendment "Guided redo (focus + guidance)"): the
 * preliminary page's **Research again** may send `focus` — some of
 * `description`, `specs`, `links`, `image`, or `everything` (the same as
 * none). A focus other than everything goes with one item only, needs
 * `tools.approve` like the note, and needs a stored result to merge into
 * (`not_researchable` otherwise). It costs one press like any other. An
 * **image-only** focus runs the image stage alone — **Find a different image**
 * (`requestImageRetry`), with the note — and answers 202 with `imageOnly`;
 * anything else is queued as usual and handed to the run as its fourth
 * argument, and the stored result is marked with the redo
 * (`markRedoRequest`) so the page can say what is being redone.
 *
 * **An item whose image search is still running is not researched again**
 * (`image_retry_running`): the redo would move the row out from under the
 * search, which could then never land.
 *
 * Refusals are `PendingApiError` bodies. The English `error` is a fallback;
 * clients render the `code` (Article 6).
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

/**
 * One to a sanity bound of ids, each a uuid. The real ceiling —
 * {@link RESEARCH_MAX_ITEMS_PER_REQUEST} — is checked after de-duplication so
 * it can answer with its own code; this bound only stops a body nobody's
 * table could have produced.
 */
const bodySchema = z.strictObject({
  ids: z.array(z.string().refine(isUuid)).min(1).max(1000),
  /**
   * The reviewer's instruction beside **Research again** (amendment "reviewer
   * notes"): one item only, `tools.approve` only, one line of at most
   * `REVIEWER_NOTE_MAX_CHARS` once cleaned (`parseReviewerNote`). The raw bound
   * here only stops a body no textarea could have produced.
   */
  note: z.string().max(4000).nullable().optional(),
  /**
   * What to redo (amendment "Guided redo"): choices from
   * `RESEARCH_FOCUS_CHOICES`, checked by `parseResearchFocus`. The raw bound
   * only stops a body the dialog could not have produced.
   */
  focus: z.array(z.string().max(20)).max(10).nullable().optional(),
});

const DAY_MS = 24 * 60 * 60_000;

function refuse(
  status: number,
  code: PendingApiErrorCode,
  error: string,
  extra: Pick<PendingApiError, "ids" | "remaining"> = {},
  headers?: Record<string, string>
): Response {
  const body: PendingApiError = { code, error, ...extra };
  return Response.json(body, { status, headers });
}

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("research", identity);
  if (!decision.allowed) {
    return refuse(429, "rate_limited", "Too many requests. Please slow down.", {}, {
      "Retry-After": String(decision.retryAfterSeconds),
    });
  }
  if (identity.role === "anonymous" || !identity.userId) {
    return refuse(401, "sign_in_required", "Sign in to research equipment.");
  }
  if (!can(identity, "tools.add")) {
    return refuse(403, "forbidden", "Your account cannot add equipment.");
  }
  const userId = identity.userId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return refuse(400, "invalid_body", "The request body is not JSON.");
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return refuse(400, "invalid_body", "Send { ids: [...] } with at least one item id.");
  }
  const ids = [...new Set(parsed.data.ids)];
  const note = parseReviewerNote(parsed.data.note);
  if (note === "too_long" || note === "invalid") {
    return refuse(400, "invalid_body", `A note for research is one line of at most ${REVIEWER_NOTE_MAX_CHARS} characters.`);
  }
  if (note !== null && ids.length !== 1) {
    return refuse(400, "invalid_body", "A note for research goes with one item at a time.");
  }
  if (note !== null && !can(identity, "tools.approve")) {
    return refuse(403, "forbidden", "Only a reviewer can send research a note.");
  }
  const focus = parseResearchFocus(parsed.data.focus);
  if (focus === "invalid") {
    return refuse(400, "invalid_body", "Focus on some of description, specs, links and image, or on everything.");
  }
  if (focus !== null && ids.length !== 1) {
    return refuse(400, "invalid_body", "A focused redo goes with one item at a time.");
  }
  if (focus !== null && !can(identity, "tools.approve")) {
    return refuse(403, "forbidden", "Only a reviewer can redo part of the research.");
  }
  if (ids.length > RESEARCH_MAX_ITEMS_PER_REQUEST) {
    return refuse(
      400,
      "too_many_items",
      `Research at most ${RESEARCH_MAX_ITEMS_PER_REQUEST} items at a time.`
    );
  }

  try {
    const items = await listPendingTools({ ids });
    const refusal = checkItems(ids, items, identity);
    if (refusal) return refusal;
    if (focus !== null && !items[0]?.research) {
      // Nothing stored to merge the focused fields into.
      return refuse(409, "not_researchable", "Only researched items can have part of their research redone.", { ids });
    }
    const searching = items.filter((item) => imageRetryInProgress(item.research?.imageRetry)).map((item) => item.id);
    if (searching.length > 0) {
      return refuse(409, "image_retry_running", "An image search is still running for this item.", { ids: searching });
    }

    if (isImageOnlyFocus(focus)) return await redoImageOnly(userId, items[0].id, note);

    // The allowance counts research, not add-unit items, which cost nothing.
    const toResearch = items.filter((item) => item.duplicateResolution !== "add_unit").map((item) => item.id);
    const asUnit = items.filter((item) => item.duplicateResolution === "add_unit").map((item) => item.id);

    // The id the run is started with, stamped on the rows it may write to.
    const requestId = randomUUID();
    // May come back shorter than asked: a concurrent press already queued
    // some of these, and taking them again would start a second run.
    const allowed = await queueForResearchWithinAllowance(toResearch, {
      requestedBy: userId,
      requestId,
      limit: RESEARCH_DAILY_ITEM_LIMIT,
      since: new Date(Date.now() - DAY_MS),
    });
    if (!allowed.ok) {
      return refuse(
        429,
        "daily_limit",
        `That would pass today's limit of ${RESEARCH_DAILY_ITEM_LIMIT} researched items.`,
        { remaining: allowed.remaining }
      );
    }
    const queued = allowed.queued;
    const readyAsUnit = await markReadyAsUnit(asUnit, { requestedBy: userId });

    if (queued.length === 0) {
      if (toResearch.length > 0 && readyAsUnit.length === 0) {
        // Everything passed the checks above and nothing moved: another press
        // took these between that read and this write. Saying "nothing needed
        // researching" would be untrue (Article 4).
        return refuse(409, "not_researchable", "Some of these items are already researching or settled.", {
          ids: toResearch,
        });
      }
      const body: ResearchStartedResponse = { requestId, runId: null, queued, readyAsUnit };
      return Response.json(body, { status: 200 });
    }

    // A Research again on one researched item: say on its result what is being redone.
    const redoOf = items.length === 1 && items[0].research ? items[0].id : null;
    if (redoOf && queued.includes(redoOf)) {
      try {
        await markRedoRequest(redoOf, { requestId, focus });
      } catch (error) {
        // Only the page's "Re-researching …" line depends on it; the redo itself does not.
        console.error(`[research] could not mark the redo for request ${requestId}:`, error);
      }
    }

    let runId: string;
    try {
      // The note travels to both model steps and is recorded on the result;
      // a focus, only when there is one, so an unscoped run starts as it always did.
      const run = await start(
        researchBatch,
        focus ? [requestId, queued, note, focus] : note ? [requestId, queued, note] : [requestId, queued]
      );
      runId = run.runId;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[research] start failed for request ${requestId}:`, message);
      await recordStartFailure(queued, `Could not start research: ${message}`);
      return refuse(502, "start_failed", "Research could not be started. Try again.", { ids: queued });
    }

    try {
      await setWorkflowRun(queued, runId);
    } catch (error) {
      // The run has started and will research these items whether or not the
      // id is on the rows — saying 502 here would tell the person nothing is
      // happening while it is. The id is for diagnosis; log that it is missing.
      console.error(`[research] run ${runId} started but its id was not stored:`, error);
    }

    const body: ResearchStartedResponse = { requestId, runId, queued, readyAsUnit };
    return Response.json(body, { status: 202 });
  } catch (error) {
    console.error("[research] request failed", error);
    return refuse(500, "failed", "Research could not be started.");
  }
}

/**
 * An image-only redo: **Find a different image**, with the note — the same
 * allowance, lock and run as the preliminary page's own button
 * (`requestImageRetry`). Its refusals answer in this route's codes.
 */
async function redoImageOnly(userId: string, id: string, note: string | null): Promise<Response> {
  const result = await requestImageRetry({ userId }, { id, note });
  if (result.ok) {
    const body: ResearchStartedResponse = {
      requestId: result.requestId,
      runId: null,
      queued: [],
      readyAsUnit: [],
      imageOnly: true,
    };
    return Response.json(body, { status: 202 });
  }
  switch (result.error) {
    case "not_found":
      return refuse(404, "not_found", "This item no longer exists.", { ids: [id] });
    case "not_editable":
      return refuse(409, "not_editable", "This item has no image search to redo — it may have its own photo.", { ids: [id] });
    case "image_retry_running":
      return refuse(409, "image_retry_running", "An image search is still running for this item.", { ids: [id] });
    case "daily_limit":
      return refuse(429, "daily_limit", `That would pass today's limit of ${RESEARCH_DAILY_ITEM_LIMIT} researched items.`);
    case "start_failed":
      return refuse(502, "start_failed", "The image search could not be started. Try again.", { ids: [id] });
  }
}

/**
 * The first reason these items cannot be researched by this caller, or null.
 * In order: missing, not theirs, an undecided duplicate, not researchable —
 * each answering with every id it applies to, so the card can mark the rows.
 */
function checkItems(
  ids: string[],
  items: PendingTool[],
  identity: Parameters<typeof canActOnPendingTool>[0]
): Response | null {
  const found = new Set(items.map((item) => item.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    return refuse(404, "not_found", "Some of these items no longer exist.", { ids: missing });
  }

  const forbidden = items.filter((item) => !canActOnPendingTool(identity, item)).map((item) => item.id);
  if (forbidden.length > 0) {
    return refuse(403, "forbidden", "You cannot research items somebody else identified.", {
      ids: forbidden,
    });
  }

  const undecided = items.filter(hasUnresolvedDuplicate).map((item) => item.id);
  if (undecided.length > 0) {
    return refuse(409, "unresolved_duplicate", "Decide what to do with the possible duplicates first.", {
      ids: undecided,
    });
  }

  const settled = items.filter((item) => !isResearchable(item)).map((item) => item.id);
  if (settled.length > 0) {
    return refuse(409, "not_researchable", "Some of these items are already researching or settled.", {
      ids: settled,
    });
  }
  return null;
}
