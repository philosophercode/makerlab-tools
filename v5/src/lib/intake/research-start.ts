import "server-only";

import { randomUUID } from "node:crypto";
import { start } from "workflow/api";
import type { Identity } from "../auth/identity";
import { can } from "../auth/permissions";
import {
  listPendingTools,
  markReadyAsUnit,
  markRedoRequest,
  queueForResearchWithinAllowance,
  recordStartFailure,
  setWorkflowRun,
  type PendingTool,
} from "../data/pending-tools";
import { researchLimitFor } from "../data/research-allowances";
import { researchBatch } from "../../workflows/research-batch";
import { canActOnPendingTool, hasUnresolvedDuplicate, isResearchable } from "./access";
import { requestImageRetry } from "./image-retry";
import { imageRetryInProgress } from "./image-retry-state";
import { RESEARCH_MAX_ITEMS_PER_REQUEST, REVIEWER_NOTE_MAX_CHARS } from "./limits";
import { isImageOnlyFocus, parseResearchFocus } from "./research-focus";
import { parseReviewerNote } from "./reviewer-note";
import type { PendingApiError, PendingApiErrorCode, ResearchStartedResponse } from "./types";

/**
 * Starting research on pending items — **Research selected (N)**, **Research
 * again** and a guided redo (spec §5.4 step 6; amendment "Guided redo").
 *
 * Moved verbatim from `POST /api/pending-tools/research` so that the route
 * and the assistant's `research_pending_items` card (assistant–GUI parity
 * spec §4.9 #14, §11 answer 3) run **one** start: the same checks in the same
 * order, the same allowance decided in one transaction with the queueing, the
 * same workflow. The route keeps what is HTTP's — its limiter tier, sign-in
 * and `tools.add` as 401/403, the body's shape — and the action keeps
 * `performAction`'s gate; everything after is here.
 *
 * Every refusal is a `PendingApiError` with the status the route answers it
 * with; the action reads the `code` (and `remaining`) off the same answer.
 */

/** What a start answers: the route's status and body, success or refusal. */
export type ResearchAnswer =
  | { status: 200 | 202; body: ResearchStartedResponse }
  | { status: number; body: PendingApiError };

/** The request, once its shape is checked (ids are uuids, note and focus raw). */
export interface ResearchRequest {
  ids: string[];
  note?: string | null;
  focus?: string[] | null;
}

const DAY_MS = 24 * 60 * 60_000;

function refuse(
  status: number,
  code: PendingApiErrorCode,
  error: string,
  extra: Pick<PendingApiError, "ids" | "remaining"> = {}
): ResearchAnswer {
  return { status, body: { code, error, ...extra } };
}

/** Whether an answer started something (or moved add-unit items on). */
export function researchStarted(answer: ResearchAnswer): answer is { status: 200 | 202; body: ResearchStartedResponse } {
  return answer.status === 200 || answer.status === 202;
}

/**
 * Research `request.ids` for `identity`, who has passed the surface's gate
 * (signed in, `tools.add`). Every check runs before anything moves.
 */
export async function startResearch(identity: Identity & { userId: string }, request: ResearchRequest): Promise<ResearchAnswer> {
  const userId = identity.userId;
  const parsed = { data: request };
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
    // The daily allowance plus any setup allowance a super admin granted
    // (bulk intake spec §4.2), counted against the one ledger.
    const limit = await researchLimitFor(userId);
    // May come back shorter than asked: a concurrent press already queued
    // some of these, and taking them again would start a second run.
    const allowed = await queueForResearchWithinAllowance(toResearch, {
      requestedBy: userId,
      requestId,
      limit,
      since: new Date(Date.now() - DAY_MS),
    });
    if (!allowed.ok) {
      return refuse(
        429,
        "daily_limit",
        `That would pass today's limit of ${limit} researched items.`,
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
      return { status: 200, body };
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
    return { status: 202, body };
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
async function redoImageOnly(userId: string, id: string, note: string | null): Promise<ResearchAnswer> {
  const result = await requestImageRetry({ userId }, { id, note });
  if (result.ok) {
    const body: ResearchStartedResponse = {
      requestId: result.requestId,
      runId: null,
      queued: [],
      readyAsUnit: [],
      imageOnly: true,
    };
    return { status: 202, body };
  }
  switch (result.error) {
    case "not_found":
      return refuse(404, "not_found", "This item no longer exists.", { ids: [id] });
    case "not_editable":
      return refuse(409, "not_editable", "This item has no image search to redo — it may have its own photo.", { ids: [id] });
    case "image_retry_running":
      return refuse(409, "image_retry_running", "An image search is still running for this item.", { ids: [id] });
    case "daily_limit":
      return refuse(429, "daily_limit", "That would pass today's research allowance.");
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
): ResearchAnswer | null {
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
