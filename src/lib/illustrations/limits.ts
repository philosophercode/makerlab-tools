/**
 * The numbers chat illustrations run on (gateway spec amendment 2026-10-07
 * "Generated illustrations in the chat"). One module so the capability, the
 * ledger, the prompt and the docs cannot disagree; client-safe and
 * dependency-free.
 *
 * The caps are first settings, chosen to keep illustrations a cheap extra:
 * at the default model's $0.01 an image, the lab-wide budget is about 100
 * pictures a day and at most about $30 a month. Raise them here.
 */

/** Illustrations one signed-in person may have made in any rolling 24 hours. */
export const ILLUSTRATION_DAILY_PER_PERSON = 3;

/** Dollars all illustrations together may cost in any rolling 24 hours, lab-wide. */
export const ILLUSTRATION_LAB_DAILY_BUDGET_USD = 1;

/**
 * What one image costs on the default model (`meta/muse-image-1.0`, a flat
 * $0.01 on the Gateway's price list, 2026-10-07). Reserved against the
 * budget before the call, and kept as the cost when the Gateway reports none.
 */
export const ILLUSTRATION_DEFAULT_MODEL_COST_USD = 0.01;

/**
 * The reservation for a `MODEL_ILLUSTRATION` override, whose price this code
 * does not know: high on purpose, so an unknown model can only make the
 * budget run out early, never late. The Gateway's reported cost replaces it.
 */
export const ILLUSTRATION_UNKNOWN_MODEL_COST_USD = 0.05;

/** The size asked for: square, enough for a chat column on a 2× screen. */
export const ILLUSTRATION_SIZE = "1024x1024" as const;

/** The longest plan or idea the tool accepts from the model. */
export const ILLUSTRATION_DESCRIPTION_MAX_CHARS = 3000;

/** The most of it (after cleaning) that goes into the image prompt. */
export const ILLUSTRATION_CONTENT_MAX_CHARS = 900;

/** An image larger than this is refused rather than stored. */
export const ILLUSTRATION_MAX_BYTES = 8 * 1024 * 1024;

/** The model call gives up after this long; the student is waiting. */
export const ILLUSTRATION_TIMEOUT_MS = 60_000;

/** Where illustrations land in the private Blob store. The store adds a random suffix. */
export const ILLUSTRATION_BLOB_PREFIX = "chat/illustrations/";

/** The window both caps are counted over. */
export const ILLUSTRATION_WINDOW_MS = 24 * 60 * 60_000;

/**
 * The label every illustration carries, in English (the chat shows the
 * translated `chat.illustration.caption`). Also what the assistant is told the
 * student sees.
 */
export const ILLUSTRATION_CAPTION =
  "AI-generated illustration, not a photo of our equipment. Check the manual and staff for exact steps.";
