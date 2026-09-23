import { RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";
import { ZodError } from "zod";
import { classifyModelError, type ModelErrorClassification } from "../ai/gateway-errors.ts";
import { MODEL_JOBS } from "../ai/models.ts";
import { ModelOutputError } from "./model-output.ts";

/**
 * What a research step does with an error (spec §3.7 "Errors", the 2026-09-22
 * amendment; gateway spec §3.1).
 *
 * Two answers, because the Workflow SDK has two:
 *
 * - **{@link RetryableError}** — the Gateway, the provider behind it or the
 *   network was having a bad minute. A rate limit, a 5xx, a connection that
 *   never answered, or the step's own 240-second `AbortSignal` firing on a slow
 *   provider. The step runs again, up to `RESEARCH_STEP_MAX_RETRIES` more
 *   times, and the row stays `researching` in between so the retry resumes it.
 * - **{@link FatalError}** — asking again will get the same answer. A model id
 *   the Gateway does not know or an override that is not an id at all, a
 *   Gateway that is not authenticated, any other refused request, an answer
 *   that does not parse, or a result that fails the schema. The item goes
 *   straight to `failed`.
 *
 * **Model-call failures are judged by `classifyModelError` first**, so this
 * file knows the app's words for a failure ("rate limited", "model not found")
 * and never a provider's. A configuration error names the variable to fix —
 * `model not available (MODEL_RESEARCH_READ)` — taken from the stage that
 * failed, never the variable's value.
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

export type ResearchStage = "search" | "read" | "verify" | "assemble";

const STAGE_LABEL: Record<ResearchStage, string> = {
  search: "Research (search)",
  read: "Research (reading pages)",
  verify: "Research (checking links)",
  assemble: "Research (assembling the result)",
};

/**
 * The variable that picks each model-calling stage's model — what a
 * "model not available" message tells somebody to fix.
 */
const STAGE_MODEL_ENV: Partial<Record<ResearchStage, string>> = {
  search: MODEL_JOBS.researchSearch.env,
  read: MODEL_JOBS.researchRead.env,
};

/** Where the Gateway's credentials come from, for an authentication failure. */
const GATEWAY_AUTH_HINT = "AI_GATEWAY_API_KEY or the deployment's OIDC token";

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

  const model = classifyModelError(error);
  if (model) return fromModelError(model, cause, stage);

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

/** A model-call failure, in `classifyModelError`'s words, as the error the step throws. */
function fromModelError(
  model: ModelErrorClassification,
  cause: unknown,
  stage: ResearchStage
): FatalError | RetryableError {
  const label = STAGE_LABEL[stage];
  const http = model.statusCode === null ? "" : ` (HTTP ${model.statusCode})`;

  switch (model.kind) {
    case "model_config":
    case "model_not_found": {
      // A malformed override names its own variable; an unknown id is the stage's.
      const envVar = (model.kind === "model_config" ? model.envVar : null) ?? STAGE_MODEL_ENV[stage] ?? null;
      return new FatalError(`${label}: model not available${envVar ? ` (${envVar})` : ""}.`);
    }
    case "auth":
      return new FatalError(`${label}: the AI Gateway is not authenticated (${GATEWAY_AUTH_HINT}).`);
    case "rate_limited": {
      const wait = model.retryAfterMs;
      return new RetryableError(`${label}: the model provider is rate limiting (HTTP 429).`, {
        retryAfter:
          wait !== null && wait > 0 ? Math.min(wait, MAX_RATE_LIMIT_WAIT_MS) : DEFAULT_RATE_LIMIT_WAIT_MS,
      });
    }
    case "provider_unavailable":
      return new RetryableError(
        model.statusCode === null
          ? `${label}: the model provider could not be reached${reason(cause)}.`
          : `${label}: the model provider failed${http}${reason(cause)}.`,
        { retryAfter: SERVER_ERROR_WAIT_MS }
      );
    case "timeout":
      return new RetryableError(
        STAGE_MODEL_ENV[stage]
          ? `${label}: timed out — the model provider was too slow.`
          : `${label}: timed out.`,
        { retryAfter: SERVER_ERROR_WAIT_MS }
      );
    case "invalid_request":
      return new FatalError(`${label}: the model provider refused the request${http}${reason(cause)}.`);
  }
}

/** A `{ status }` or `{ statusCode }` on an error some fetch wrapper threw. */
function fetchStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  const value = typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : null;
  return value !== null && value >= 400 && value < 600 ? value : null;
}

/**
 * The provider's own one-line reason, when it gave one — `: model not found` —
 * clipped and scrubbed. The SDK lifts the Gateway's `{ error: { message } }`
 * into `message`.
 */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message?.trim() : "";
  return message ? `: ${clip(message)}` : "";
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

/**
 * Remove anything that looks like a credential before it can reach a column or
 * a log: provider keys (`sk-…`), AI Gateway keys (`vck_…`), a JWT such as the
 * deployment's OIDC token, and whatever follows a bearer or key header.
 */
export function scrub(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bvck_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[redacted]")
    .replace(/(bearer|x-api-key)\s*[:=]?\s*\S+/gi, "$1 [redacted]");
}
