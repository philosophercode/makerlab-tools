/**
 * The numbers the two-step add-tool flow runs on (spec §5.4, §8, and the
 * 2026-09-22 amendment that resized research for the Hobby plan).
 *
 * One module so the route, the workflow, the prompt and the UI cannot disagree
 * about a limit, and client-safe so the card can say "up to 25" from the same
 * constant the route enforces.
 */

/** Items one Research press may send (§5.4 step 6), and one workflow batch's size. */
export const RESEARCH_MAX_ITEMS_PER_REQUEST = 25;

/** Items one person may research per rolling 24 hours (§8). Add-unit items are free. */
export const RESEARCH_DAILY_ITEM_LIMIT = 100;

/** Items researched at once inside one workflow run (§3.7: three at a time). */
export const RESEARCH_CONCURRENCY = 3;

/** Web searches per item — four, not §3.7's eight (2026-09-22 amendment). */
export const RESEARCH_MAX_WEB_SEARCHES = 4;

/** Web fetches per item — four, not §3.7's eight (2026-09-22 amendment). */
export const RESEARCH_MAX_WEB_FETCHES = 4;

/**
 * The `AbortSignal` budget inside each research step. Hobby kills a function at
 * 300 seconds; stopping at 240 lets the step record why in `research_error`
 * instead of being killed mid-flight.
 */
export const RESEARCH_STEP_TIMEOUT_MS = 240_000;

/** `researchItem.maxRetries` — a property on the step function, not an option. */
export const RESEARCH_STEP_MAX_RETRIES = 2;

/**
 * How long an item may sit `queued` with no workflow run and no recorded start
 * failure before another Research press may take it over. Short enough that a
 * request that died between queueing and `start()` does not strand its items,
 * long enough that two presses a second apart cannot both start a run.
 */
export const RESEARCH_START_STALE_MS = 5 * 60_000;

/** Items one `identify_tools` call may create. */
export const IDENTIFY_MAX_ITEMS = 25;

/** Web searches the intake prompt allows to settle a model name (§5.4 step 2). */
export const IDENTIFY_MAX_MODEL_NAME_SEARCHES = 2;

/**
 * A research run still holding an item this long after the press is taken to
 * be abandoned, and the daily cron marks the item `failed` so it can be
 * researched again or discarded. The worst legitimate run — 25 items, three at
 * a time, two steps each retried twice at 240 seconds — is under four hours;
 * a day is far past it.
 */
export const RESEARCH_ABANDONED_AFTER_MS = 24 * 60 * 60_000;

/** An item left `identified` this long is discarded by the daily cron (§4.10). */
export const PENDING_IDENTIFIED_TTL_MS = 14 * 24 * 60 * 60_000;

/**
 * A discarded item is deleted by the daily cron this long after it was
 * discarded (§8 PII: "discarded pending items ... are deleted on schedule").
 * Long enough that the queue's folded-away history still shows a recent
 * discard; the same thirty days the nightly backups are kept.
 */
export const PENDING_DISCARDED_RETENTION_MS = 30 * 24 * 60 * 60_000;

/** `/admin/intake` polls this often while anything in view is queued or researching. */
export const INTAKE_POLL_INTERVAL_MS = 5_000;
