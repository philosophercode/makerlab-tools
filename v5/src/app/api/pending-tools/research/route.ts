import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import {
  listPendingTools,
  markReadyAsUnit,
  queueForResearchWithinAllowance,
  recordStartFailure,
  setWorkflowRun,
  type PendingTool,
} from "../../../../lib/data/pending-tools";
import { isUuid } from "../../../../lib/data/uuid";
import { canActOnPendingTool, hasUnresolvedDuplicate, isResearchable } from "../../../../lib/intake/access";
import {
  RESEARCH_DAILY_ITEM_LIMIT,
  RESEARCH_MAX_ITEMS_PER_REQUEST,
  REVIEWER_NOTE_MAX_CHARS,
} from "../../../../lib/intake/limits";
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
  note: z.string().max(2000).nullable().optional(),
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

    let runId: string;
    try {
      // The note travels to both model steps and is recorded on the result.
      const run = await start(researchBatch, note ? [requestId, queued, note] : [requestId, queued]);
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
