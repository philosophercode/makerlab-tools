import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { isUuid } from "../../../../lib/data/uuid";
import { startResearch } from "../../../../lib/intake/research-start";
import type { PendingApiError, PendingApiErrorCode } from "../../../../lib/intake/types";
import { checkRateLimit } from "../../../../lib/rate-limit";

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
  // Everything after the gate and the body's shape is the one start the
  // assistant's card runs too (`lib/intake/research-start.ts`).
  const answer = await startResearch({ ...identity, userId }, parsed.data);
  return Response.json(answer.body, { status: answer.status });
}
