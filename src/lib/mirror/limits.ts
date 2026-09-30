/**
 * The Notion mirror's numbers (spec §3.8, §8), in one place so the push, the
 * claims in `data/mirrors.ts` and the page's copy cannot disagree.
 *
 * Relative imports only (none here): workflow step code loads this under plain
 * Node.
 */

/** One push stops starting new Notion calls after this long; the rest waits for the next push. */
export const MIRROR_PUSH_BUDGET_MS = 45_000;

/** Notion's documented average rate limit is 3 requests per second per integration. */
export const MIRROR_REQUESTS_PER_SECOND = 3;

/** How many 429s one request may wait out before it gives up as `rate_limited`. */
export const MIRROR_MAX_RATE_LIMIT_RETRIES = 3;

/** A `running_since` older than this is a push that died; the overlap guard lets the next one in. */
export const MIRROR_RUN_STALE_MINUTES = 15;

/** Sync now: one push per mirror per this many minutes (§8 rate limiting). */
export const MIRROR_SYNC_NOW_MINUTES = 15;

/** How long `mirrorPushAfterChange` sleeps so a burst of edits becomes one push (§3.8 trigger 1). */
export const MIRROR_COALESCE_DELAY = "2m";

/** A `push_requested_at` older than this is a coalescing run that never finished; a new change may claim again. */
export const MIRROR_COALESCE_STALE_MINUTES = 10;

/**
 * The watermark a push advances `last_synced_at` to is its claim time minus
 * this. A row committed by a transaction that began before the claim but
 * committed after the push read its table carries an `updated_at` before the
 * claim; the margin makes the next push select it again. Re-pushing a few
 * unchanged rows is harmless; missing one is not.
 */
export const MIRROR_WATERMARK_SAFETY_MINUTES = 5;

/** A workflow pushes an `incomplete` mirror again at most this many times before leaving it to the next trigger. */
export const MIRROR_MAX_ROUNDS = 6;

/**
 * A round skipped because another push holds the mirror waits
 * {@link MIRROR_BUSY_PAUSE} and tries again, at most this many times, so a
 * change or a backstop that arrives mid-push is still pushed once that push is
 * done — whose table reads may have been taken before the change landed.
 */
export const MIRROR_BUSY_RETRIES = 10;

/** How long a round skipped as `running` waits before trying the claim again. */
export const MIRROR_BUSY_PAUSE = "30s";

/** `maxRetries` on each mirror step function. */
export const MIRROR_STEP_MAX_RETRIES = 2;

/** How often `/admin/mirror` polls while a push is running or pending. */
export const MIRROR_POLL_INTERVAL_MS = 5_000;
