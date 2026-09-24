import { RetryError } from "ai";
import { FatalError, RetryableError } from "workflow";
import { classifyModelError } from "../ai/gateway-errors.ts";
import { scrub } from "../research/errors.ts";
import { ExtractOutputError } from "./extract-output.ts";

/**
 * What a bulk-intake step does with an error — the research steps' two answers
 * (`research/errors.ts`), for the import's two model calls. A rate limit, a
 * provider's bad minute or a timeout is retried; anything else — a model the
 * Gateway does not know, no credentials, an answer that is not the JSON asked
 * for — fails at once, with a short message fit for `parse_error` and for
 * nothing more (no provider text beyond a clipped reason, nothing key-shaped).
 *
 * Plain Node, relative imports.
 */
export function classifyImportError(error: unknown, label: string): FatalError | RetryableError {
  if (FatalError.is(error) || RetryableError.is(error)) return error;
  const cause = RetryError.isInstance(error) ? error.lastError : error;
  const model = classifyModelError(error);
  if (model) {
    switch (model.kind) {
      case "rate_limited":
        return new RetryableError(`${label}: the model provider is rate limiting.`, {
          retryAfter: model.retryAfterMs && model.retryAfterMs > 0 ? Math.min(model.retryAfterMs, 60_000) : 20_000,
        });
      case "provider_unavailable":
      case "timeout":
        return new RetryableError(`${label}: the model provider did not answer in time.`, { retryAfter: 5_000 });
      case "auth":
        return new FatalError(`${label}: the AI Gateway is not authenticated.`);
      case "model_config":
      case "model_not_found":
        return new FatalError(`${label}: model not available${model.kind === "model_config" && model.envVar ? ` (${model.envVar})` : ""}.`);
      case "invalid_request":
        return new FatalError(`${label}: the model provider refused the request.`);
    }
  }
  if (cause instanceof ExtractOutputError) return new FatalError(`${label}: ${cause.message}.`);
  const message = cause instanceof Error ? cause.message : String(cause);
  return new FatalError(`${label}: ${scrub(message).replace(/\s+/g, " ").slice(0, 160)}`);
}
