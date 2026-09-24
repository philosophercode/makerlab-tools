import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";
import { ZodError } from "zod";
import { ModelOutputError } from "./model-output.ts";

/**
 * What a research step does with an error (spec §3.7 "Errors", the 2026-09-22
 * amendment).
 *
 * Two answers, because the Workflow SDK has two:
 *
 * - **{@link RetryableError}** — the provider or the network was having a bad
 *   minute. A 429, any 5xx (Anthropic's 529 "overloaded" included), or the
 *   step's own 240-second `AbortSignal` firing on a slow provider. The step
 *   runs again, up to `RESEARCH_STEP_MAX_RETRIES` more times, and the row stays
 *   `researching` in between so the retry resumes it.
 * - **{@link FatalError}** — asking again will get the same answer. A 4xx other
 *   than 429 (a malformed request, a refused key), an answer that does not
 *   parse, a result that fails the schema, or no API key at all. The item goes
 *   straight to `failed`.
 *
 * Whichever it is, **the message is what `research_error` will say** once the
 * workflow gives up on the item, and that column is the diagnosis record — run
 * history on Hobby lasts a day (the amendment). So it names the step and the
 * cause in one short sentence, and carries nothing a provider echoed back
 * beyond a clipped reason: no request body, no headers, and never anything
 * shaped like a key.
 *
 * Relative imports with `.ts` extensions and no `"server-only"`: the workflow
 * step bundle loads this under plain Node.
 */

export type ResearchStage = "search" | "fetch" | "verify" | "assemble";

const STAGE_LABEL: Record<ResearchStage, string> = {
  search: "Research (search)",
  fetch: "Research (reading pages)",
  verify: "Research (checking links)",
  assemble: "Research (assembling the result)",
};

/** A provider's own reason is kept, but only this much of it. */
const MAX_REASON_LENGTH = 160;

/** How long a 429 waits when the provider does not say. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 20_000;

/** The longest a `retry-after` header may make a step wait — it is inside a 240-second budget. */
const MAX_RATE_LIMIT_WAIT_MS = 60_000;

/** How long a 5xx or a timeout waits before trying again. */
const SERVER_ERROR_WAIT_MS = 5_000;

/**
 * `error` as the error a step should throw. Already-classified errors pass
 * through unchanged, so a step can throw its own `FatalError` and still route
 * everything through here.
 */
export function classifyResearchError(error: unknown, stage: ResearchStage): FatalError | RetryableError {
  if (FatalError.is(error) || RetryableError.is(error)) return error;
  const label = STAGE_LABEL[stage];

  // generateText's own retry loop wraps the last failure; judge that one.
  const cause = RetryError.isInstance(error) ? error.lastError : error;

  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;
    const reason = providerReason(cause);
    if (status === 429) {
      return new RetryableError(`${label}: the model provider is rate limiting (HTTP 429).`, {
        retryAfter: retryAfterMs(cause.responseHeaders),
      });
    }
    if (status !== undefined && status >= 500) {
      return new RetryableError(`${label}: the model provider failed (HTTP ${status})${reason}.`, {
        retryAfter: SERVER_ERROR_WAIT_MS,
      });
    }
    if (status === undefined) {
      // No response at all — a dropped connection, which is the network's bad minute.
      return new RetryableError(`${label}: the model provider could not be reached${reason}.`, {
        retryAfter: SERVER_ERROR_WAIT_MS,
      });
    }
    return new FatalError(`${label}: the model provider refused the request (HTTP ${status})${reason}.`);
  }

  if (isTimeout(cause)) {
    return new RetryableError(`${label}: timed out — the model provider was too slow.`, {
      retryAfter: SERVER_ERROR_WAIT_MS,
    });
  }

  if (LoadAPIKeyError.isInstance(cause)) {
    return new FatalError(`${label}: no model API key is configured.`);
  }

  if (cause instanceof ModelOutputError) {
    return new FatalError(`${label}: ${cause.message}`);
  }

  if (cause instanceof ZodError) {
    const where = cause.issues
      .slice(0, 3)
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    return new FatalError(`${label}: the result did not match the expected shape (${where}).`);
  }

  const status = fetchStatus(cause);
  if (status !== null) {
    if (status === 429 || status >= 500) {
      return new RetryableError(`${label}: a request failed (HTTP ${status}).`, {
        retryAfter: status === 429 ? DEFAULT_RATE_LIMIT_WAIT_MS : SERVER_ERROR_WAIT_MS,
      });
    }
    return new FatalError(`${label}: a request was refused (HTTP ${status}).`);
  }

  // Anything else is a bug or an outage we have no rule for. Fatal, so a
  // deterministic bug does not burn three attempts' worth of searches.
  return new FatalError(`${label}: ${clip(errorMessage(cause))}`);
}

/** The step's deadline, or the provider SDK's name for it. */
function isTimeout(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/** A `{ status }` or `{ statusCode }` on an error some fetch wrapper threw. */
function fetchStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : null;
  return value !== null && value >= 400 && value < 600 ? value : null;
}

/** `retry-after` in seconds, as milliseconds, clamped to something a step can afford. */
function retryAfterMs(headers: Record<string, string> | undefined): number {
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  const seconds = raw === undefined ? NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RATE_LIMIT_WAIT_MS;
  return Math.min(seconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
}

/**
 * The provider's own one-line reason, when it gave one — `: model not found` —
 * clipped and scrubbed. Anthropic's error body is `{ error: { message } }`;
 * the SDK already lifts that into `message`.
 */
function providerReason(error: APICallError): string {
  const message = error.message?.trim();
  if (!message) return "";
  return `: ${clip(message)}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "unknown error";
}

/** One line, short, and with anything key-shaped removed. */
function clip(message: string): string {
  const oneLine = scrub(message).replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_REASON_LENGTH ? `${oneLine.slice(0, MAX_REASON_LENGTH - 1)}…` : oneLine;
}

/** Remove anything that looks like a credential before it can reach a column or a log. */
export function scrub(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/(bearer|x-api-key)\s*[:=]?\s*\S+/gi, "$1 [redacted]");
}
