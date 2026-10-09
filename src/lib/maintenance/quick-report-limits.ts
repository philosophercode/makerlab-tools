/**
 * The quick report form's bounds (quick report spec §8), shared by the form
 * and `POST /api/report`. Plain constants with no imports, so the client
 * bundle can read them.
 */

/** The fewest characters a report may have, after trimming: "jammed" passes, "x" does not. */
export const QUICK_REPORT_TEXT_MIN = 3;

/** The most characters a report may have. Half `report_issue`'s description cap: a few paragraphs. */
export const QUICK_REPORT_TEXT_MAX = 2_000;

/** Photos per report. The form offers one; the route takes up to this many. */
export const QUICK_REPORT_PHOTOS_MAX = 3;

/** The request body's ceiling in bytes, checked before it is parsed. */
export const QUICK_REPORT_BODY_MAX = 16_000;

/**
 * How long the form must have been open before it may send, in milliseconds.
 * Nobody describes a fault in under two seconds; a script posting the moment
 * the page loads does. A speed bump, not a lock: the rate limits are the bound.
 */
export const QUICK_REPORT_MIN_OPEN_MS = 2_000;

/** The hidden field a person never fills and a form-filling bot does. */
export const QUICK_REPORT_TRAP_FIELD = "website";
