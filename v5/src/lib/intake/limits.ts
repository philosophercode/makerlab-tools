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

/**
 * Exa searches per item — four, not §3.7's eight (2026-09-22 amendment). An
 * **advisory** budget since the Gateway migration: the search prompt asks for at
 * most this many, and the step logs an overshoot afterwards. It cannot withdraw
 * `exa_search` mid-call — the Gateway runs every search inside the step's one
 * request (gateway spec §3.2 and its 2026-09-23 amendment; `research/steps.ts`).
 */
export const RESEARCH_MAX_WEB_SEARCHES = 4;

/**
 * Pages the research read step fetches server-side per item (gateway spec
 * §3.3) — the same four `web_fetch` was allowed.
 */
export const RESEARCH_MAX_PAGE_READS = 4;

/** @deprecated The read step no longer has a `web_fetch` tool; use {@link RESEARCH_MAX_PAGE_READS}. */
export const RESEARCH_MAX_WEB_FETCHES = RESEARCH_MAX_PAGE_READS;

/** PDFs, of those pages, handed to the read model as file parts (gateway spec §3.3). */
export const RESEARCH_MAX_PDFS_READ = 2;

/** Exa searches per chat turn — `web_search`'s old `maxUses: 5` (gateway spec §3.2). */
export const CHAT_MAX_EXA_SEARCHES = 5;

/**
 * `read_page` calls per chat turn (gateway spec §3.3). Enforced twice: inside the
 * tool, per turn (`capabilities/web.ts` — parallel calls in one step included),
 * and by `prepareStep`, which withdraws the tool for the rest of the turn.
 */
export const CHAT_MAX_PAGE_READS = 5;

/**
 * The `AbortSignal` budget inside each research step. Hobby kills a function at
 * 300 seconds; stopping at 240 lets the step record why in `research_error`
 * instead of being killed mid-flight.
 */
export const RESEARCH_STEP_TIMEOUT_MS = 240_000;

/** `researchItem.maxRetries` — a property on the step function, not an option. */
export const RESEARCH_STEP_MAX_RETRIES = 2;

// ── The image stage (gateway spec §3.5) ──────────────────────────────

/** `findImages`' own `AbortSignal` budget — the same 240 s as the other steps. */
export const IMAGE_STEP_TIMEOUT_MS = 240_000;

/** `findImages.maxRetries` — a property on the step function, as above. */
export const IMAGE_STEP_MAX_RETRIES = 2;

/**
 * Candidates gathered from the read pages (metadata, JSON-LD and gallery) and
 * Exa, de-duplicated, before probing (amendment "Composites and product crop").
 */
export const IMAGE_MAX_CANDIDATES = 10;

/** Probed images the ranking model is shown. */
export const IMAGE_MAX_RANKED = 8;

/** Ranked candidates recorded and shown on the preliminary page. */
export const IMAGE_MAX_SHOWN = 3;

/** Exa's images are added only when the read pages declared fewer than this many. */
export const IMAGE_EXA_TOPUP_BELOW = 3;

/** A candidate's shorter side must be at least this many pixels. */
export const IMAGE_MIN_SHORT_EDGE = 400;

/** The most a probed candidate (or a chosen original, at approval) may weigh. */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The longest reviewer's instruction — the optional note on **Research again**
 * and on **Find a different image** (amendment "Product-page first, front-facing
 * images, reviewer notes"). One paragraph: line breaks and runs of whitespace
 * collapse to single spaces before it is counted, stored or put in a prompt.
 * Raised from 300 by the amendment "Guided redo (focus + guidance)", so a
 * reviewer can say what was wrong and where to look in one go.
 */
export const REVIEWER_NOTE_MAX_CHARS = 1000;

/**
 * How long after a redo lands the preliminary page marks the sections it
 * changed ("Updated just now") — the page polls while it runs, so the reviewer
 * who pressed it sees the result well inside this (amendment "Guided redo").
 */
export const REDO_HIGHLIGHT_WINDOW_MS = 3 * 60_000;

/** How long the "Updated just now" mark stays on screen once shown. */
export const REDO_HIGHLIGHT_SHOW_MS = 8_000;

/**
 * A **Find a different image** run still marked running this long after it was
 * requested is taken to have died: the page stops waiting for it and offers the
 * button again. Two image-stage attempts at 240 s each fit inside it.
 */
export const IMAGE_RETRY_STALE_MS = 15 * 60_000;

/** Exa searches one **Find a different image** run may make — one, and only when it helps. */
export const IMAGE_RETRY_MAX_SEARCHES = 1;

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
