import { FatalError, RetryableError } from "workflow";
import { takeCoalescedPush } from "../data/mirrors.ts";
import { MIRROR_STEP_MAX_RETRIES } from "./limits.ts";
import { scrubSecrets } from "./notion-client.ts";
import { pushMirror, type MirrorPushOutcome } from "./push.ts";

/**
 * The Notion mirror's workflow steps (spec §3.8 "Push" and "Triggers", the
 * 2026-09-22 amendment's Workflow SDK rules).
 *
 * Three steps, each short:
 *
 * 1. {@link pushMirrorRound} — one call to `pushMirror`, which claims the
 *    mirror, pushes for at most 45 seconds (`MIRROR_PUSH_BUDGET_MS`) and
 *    records what happened. Far inside the Hobby plan's 300-second function
 *    ceiling; a first sync bigger than one budget comes back `incomplete` and
 *    the workflow runs another round.
 * 2. {@link takeCoalescedMirrors} — the coalescing run woke up: clear the
 *    waiting claims and return the mirrors to push.
 * 3. {@link finishMirrorPush} — one log line with counts and mirror ids.
 *
 * **Retries are for the database, and only for its bad minute.** `pushMirror`
 * turns every Notion failure into an outcome — a status and an error on the
 * mirror row — and throws only when Postgres does, having already released
 * `running_since` in a `finally`. So a throw here is classified once: an
 * unreachable database or a dropped connection is a {@link RetryableError}
 * (retried a minute later, `maxRetries` = {@link MIRROR_STEP_MAX_RETRIES});
 * anything else is a {@link FatalError}, because a bug gives the same answer
 * every time and should not burn attempts. The message is scrubbed of anything
 * token- or email-shaped before it reaches the run's event log.
 *
 * `maxRetries` is set **as a property on each step function**, which is how
 * the Workflow SDK reads it.
 *
 * Steps run from a pre-built bundle under plain Node (`@workflow/vitest`
 * locally, the step route in production), so nothing here or below it may
 * import `"server-only"` or `next/*`, and every import is relative.
 */

/** What one mirror's rounds came to, for the log line and the workflow's return value. */
export interface MirrorPushSummary {
  mirrorId: string;
  /** How many times `pushMirror` was called. */
  rounds: number;
  /** The last round's state, or `error` when a round threw after its retries. */
  state: MirrorPushOutcome["state"] | "error";
  pushed: number;
  archived: number;
  failed: number;
}

/** Which door the push came in through, for the log line. */
export type MirrorPushTrigger = "run" | "change";

/** A step error's own reason is kept, but only this much of it. */
const MAX_DETAIL_LENGTH = 200;

/** How long a step waits before retrying after the database dropped out. */
const DB_RETRY_AFTER = "1m";

/**
 * Push one mirror once (§3.8 steps 1–5). Returns the outcome unchanged; the
 * workflow decides whether to go again.
 */
export async function pushMirrorRound(mirrorId: string): Promise<MirrorPushOutcome> {
  "use step";
  try {
    return await pushMirror(mirrorId);
  } catch (error) {
    throw classifyMirrorStepError(error, "push");
  }
}
pushMirrorRound.maxRetries = MIRROR_STEP_MAX_RETRIES;

/**
 * Clear every waiting coalesced-push claim and return the ids of the active
 * mirrors among them (§3.8 trigger 1: "pushes every active mirror").
 */
export async function takeCoalescedMirrors(): Promise<string[]> {
  "use step";
  try {
    return await takeCoalescedPush();
  } catch (error) {
    throw classifyMirrorStepError(error, "take");
  }
}
takeCoalescedMirrors.maxRetries = MIRROR_STEP_MAX_RETRIES;

/**
 * The run is done. **One line**: the trigger, then each mirror's id, rounds,
 * final state and counts. No page titles, no row content, no people, and
 * never a token — the outcome's error detail is deliberately left out; it is
 * on the mirror row, where `/admin/mirror` shows it.
 */
export async function finishMirrorPush(trigger: MirrorPushTrigger, summaries: MirrorPushSummary[]): Promise<void> {
  "use step";
  const parts = summaries.map(
    (s) =>
      `${s.mirrorId} rounds=${s.rounds} state=${s.state} pushed=${s.pushed} archived=${s.archived} failed=${s.failed}`
  );
  console.info(
    `[mirror] ${trigger} push finished: mirrors=${summaries.length}${parts.length > 0 ? `; ${parts.join("; ")}` : ""}`
  );
}

// ── Error classification ────────────────────────────────────────────

/** Node's socket-level failures: the database was not there to answer. */
const CONNECTION_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Postgres SQLSTATEs that mean "try again": class 08 (connection exception),
 * 57P01–57P03 (the server shutting down or not accepting connections yet),
 * 53300 (too many connections), and the two transaction conflicts a retry
 * exists for (serialization failure, deadlock).
 */
function isTransientSqlState(code: string): boolean {
  return (
    /^08[0-9A-Z]{3}$/.test(code) ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    code === "53300" ||
    code === "40001" ||
    code === "40P01"
  );
}

const CONNECTION_MESSAGE =
  /connection (terminated|refused|reset|timed out|closed|ended)|terminating connection|fetch failed|socket hang up|database is unavailable/i;

/**
 * True when `error`, or anything in its `cause` chain (drizzle wraps the
 * driver's error; Neon's HTTP driver wraps `fetch`'s), is the database being
 * unreachable rather than the query being wrong. Read by shape, not
 * `instanceof`: the error may come from another bundle's copy of the class.
 */
function isTransientDbError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && typeof current === "object" && current !== null; depth += 1) {
    const { name, code, message, cause, sourceError } = current as {
      name?: unknown;
      code?: unknown;
      message?: unknown;
      cause?: unknown;
      sourceError?: unknown;
    };
    if (name === "DbUnavailableError") return true;
    if (typeof code === "string" && (CONNECTION_CODES.has(code) || isTransientSqlState(code))) return true;
    if (typeof message === "string" && CONNECTION_MESSAGE.test(message)) return true;
    current = cause ?? sourceError;
  }
  return false;
}

/** The error a step should throw. Already-classified errors pass through. */
function classifyMirrorStepError(error: unknown, stage: "push" | "take"): FatalError | RetryableError {
  if (FatalError.is(error) || RetryableError.is(error)) return error;
  const label = stage === "push" ? "Mirror push" : "Mirror push (taking the waiting pushes)";
  if (isTransientDbError(error)) {
    return new RetryableError(`${label}: the database could not be reached.`, { retryAfter: DB_RETRY_AFTER });
  }
  return new FatalError(`${label}: ${detail(error)}`);
}

/** One line, short, with anything token- or email-shaped removed. */
function detail(error: unknown): string {
  const raw =
    typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message || "unknown error"
      : typeof error === "string"
        ? error
        : "unknown error";
  const oneLine = scrubSecrets(raw).replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_LENGTH ? `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…` : oneLine;
}
