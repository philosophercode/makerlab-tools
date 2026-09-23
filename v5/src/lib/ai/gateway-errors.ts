import {
  GatewayAuthenticationError,
  GatewayError,
  GatewayFailedDependencyError,
  GatewayForbiddenError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayRateLimitError,
  GatewayResponseError,
} from "@ai-sdk/gateway";
import { APICallError, LoadAPIKeyError, RetryError } from "ai";
import { ModelConfigError } from "./models.ts";

/**
 * What went wrong with a model call, in the app's words rather than a
 * provider's (gateway spec §3.1, §5.3).
 *
 * The chat route words its apology from `kind`, and research records "model not
 * available (MODEL_RESEARCH_READ)" from it, so neither has to know which
 * provider sits behind the Gateway — which is the point of the Gateway.
 *
 * **Class checks use each class's static `isInstance`, never `instanceof`.** The
 * AI SDK marks its errors with a global symbol precisely because a workflow
 * step bundle, a Next server chunk and a test can each hold their own copy of
 * the package; `instanceof` fails across copies, the marker does not.
 *
 * Plain Node: step code imports this.
 */

export type ModelErrorKind =
  | "model_config"
  | "model_not_found"
  | "auth"
  | "rate_limited"
  | "provider_unavailable"
  | "invalid_request"
  | "timeout";

export interface ModelErrorClassification {
  kind: ModelErrorKind;
  /** The variable to fix, for a configuration error; null otherwise. */
  envVar: string | null;
  /** The HTTP status the Gateway answered, when there was one. */
  statusCode: number | null;
  /** From a `Retry-After` header, when the Gateway sent one. */
  retryAfterMs: number | null;
}

/**
 * Classify `error`, or null when it is not a model-call failure this module
 * recognises (a bug in our own code stays a bug, not an "unavailable").
 *
 * A `RetryError` — the SDK gave up after retrying — is classified by its last
 * attempt, which is the one that says why.
 */
export function classifyModelError(error: unknown): ModelErrorClassification | null {
  const cause = unwrapRetries(error);

  if (ModelConfigError.isInstance(cause)) {
    return { kind: "model_config", envVar: cause.envVar, statusCode: null, retryAfterMs: null };
  }

  if (GatewayError.isInstance(cause)) {
    const statusCode = typeof cause.statusCode === "number" ? cause.statusCode : null;
    const result = (kind: ModelErrorKind) => ({
      kind,
      envVar: null,
      statusCode,
      retryAfterMs: retryAfterFrom(cause.cause),
    });
    if (GatewayModelNotFoundError.isInstance(cause)) return result("model_not_found");
    if (GatewayAuthenticationError.isInstance(cause) || GatewayForbiddenError.isInstance(cause)) {
      return result("auth");
    }
    if (GatewayRateLimitError.isInstance(cause)) return result("rate_limited");
    if (
      GatewayInternalServerError.isInstance(cause) ||
      GatewayResponseError.isInstance(cause) ||
      GatewayFailedDependencyError.isInstance(cause)
    ) {
      return result("provider_unavailable");
    }
    if (GatewayInvalidRequestError.isInstance(cause)) return result("invalid_request");
    // `GatewayTimeoutError` is not exported; it is a GatewayError with this name.
    if (cause.name === "GatewayTimeoutError") return result("timeout");
    return result(kindForStatus(statusCode) ?? "provider_unavailable");
  }

  if (LoadAPIKeyError.isInstance(cause)) {
    return { kind: "auth", envVar: null, statusCode: null, retryAfterMs: null };
  }

  if (APICallError.isInstance(cause)) {
    const statusCode = typeof cause.statusCode === "number" ? cause.statusCode : null;
    return {
      kind: kindForStatus(statusCode) ?? "provider_unavailable",
      envVar: null,
      statusCode,
      retryAfterMs: retryAfterFrom(cause),
    };
  }

  if (isAbort(cause)) {
    return { kind: "timeout", envVar: null, statusCode: null, retryAfterMs: null };
  }

  return null;
}

function unwrapRetries(error: unknown): unknown {
  let current = error;
  // Bounded: a RetryError never nests deeply, and a cycle must not hang a route.
  for (let depth = 0; depth < 5 && RetryError.isInstance(current); depth += 1) {
    current = current.lastError;
  }
  return current;
}

function kindForStatus(status: number | null): ModelErrorKind | null {
  if (status === null) return null;
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  if (status >= 400) return "invalid_request";
  return null;
}

function isAbort(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Milliseconds from the headers of an `APICallError`: `retry-after-ms` first,
 * then `Retry-After` in seconds or as an HTTP date — the order the AI SDK's own
 * retry reads them in.
 */
function retryAfterFrom(error: unknown): number | null {
  if (!APICallError.isInstance(error)) return null;
  const headers = error.responseHeaders ?? {};
  const find = (wanted: string) => Object.entries(headers).find(([name]) => name.toLowerCase() === wanted)?.[1];
  const ms = Number(find("retry-after-ms"));
  if (find("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return Math.round(ms);
  const raw = find("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}
