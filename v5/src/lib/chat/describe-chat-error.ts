import { classifyModelError } from "../ai/gateway-errors";
import { MODEL_JOBS } from "../ai/models";

/**
 * Map a streaming/model error to a concise, user-facing message (gateway spec
 * §5.3). The AI SDK masks error text by default ("An error occurred"); this
 * surfaces the actual reason so a student isn't left with a dead-end "Something
 * went wrong" — most importantly telling a provider's bad minute apart from a
 * real bug.
 *
 * The wording is keyed on {@link classifyModelError}, so it names no provider:
 * whatever sits behind the Gateway, a 429 reads the same.
 *
 * - **A configuration problem names the variable, never its value.** A
 *   malformed `MODEL_CHAT`, or an id the Gateway does not know, says
 *   "(MODEL_CHAT)" so the admin reading the screenshot knows what to fix; the
 *   value is whatever somebody pasted, and it could be a key.
 * - **The fallback is scrubbed.** An unclassified error keeps its own message
 *   (it is usually the most useful thing to show), but anything key-shaped is
 *   removed and the whole is clipped to one short line first.
 *
 * Returned text is shown verbatim in the chat error row, in English, like the
 * rest of that row today (`ChatFab` renders `error.message` as is).
 */

/** The variable that picks the chat model. */
const CHAT_MODEL_ENV = MODEL_JOBS.chat.env;

/** An unclassified error's own message is kept, but only this much of it. */
const MAX_DETAIL_LENGTH = 200;

export function describeChatError(error: unknown): string {
  const classified = classifyModelError(error);

  switch (classified?.kind) {
    case "model_config":
    case "model_not_found":
      return `The assistant's model is not available (${classified.envVar ?? CHAT_MODEL_ENV}). Please let a lab admin know.`;
    case "auth":
      return "The assistant is misconfigured (authentication with the model provider failed). Please let a lab admin know.";
    case "rate_limited":
      return `Too many requests right now — please wait ${waitPhrase(classified.retryAfterMs)} and try again.`;
    case "provider_unavailable":
      return "The AI service is temporarily unavailable or overloaded (this is on the provider's side, not your request). Please try again in a few moments.";
    case "timeout":
      return "The request took too long and timed out. Please try again.";
    case "invalid_request":
      return "The model provider could not process this request. Try starting a new chat; if it keeps happening, please let a lab admin know.";
    default: {
      const detail = clip(messageOf(error));
      return detail ? `Something went wrong: ${detail}` : "Something went wrong. Please try again.";
    }
  }
}

/** "about 30 seconds" from a `Retry-After`, else "a moment". */
function waitPhrase(retryAfterMs: number | null): string {
  if (retryAfterMs === null || retryAfterMs <= 0) return "a moment";
  const seconds = Math.ceil(retryAfterMs / 1000);
  if (seconds > 120) return "a few minutes";
  return `about ${seconds} second${seconds === 1 ? "" : "s"}`;
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** One line, short, and with anything key-shaped removed. */
function clip(message: string): string {
  const oneLine = scrub(message).replace(/\s+/g, " ").trim();
  return oneLine.length > MAX_DETAIL_LENGTH ? `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…` : oneLine;
}

/**
 * Remove anything that looks like a credential. The same rules as
 * `research/errors.ts`'s `scrub`, repeated rather than imported so this module
 * does not pull the Workflow SDK into the chat route; plus the Gateway's own
 * key prefix and a bare JWT (the OIDC token's shape).
 */
export function scrub(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/vck_[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/(bearer|x-api-key)\s*[:=]?\s*\S+/gi, "$1 [redacted]");
}
