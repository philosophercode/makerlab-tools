import type { FileUIPart, UIMessage } from "ai";
import type { Role } from "../auth/roles";
import { withRecentPhotos } from "./photo-parts";

/**
 * Bound what one chat request may put in front of the model (security fix
 * 2026-10-05, Article 4).
 *
 * The chat's rate limit counts requests, and the client sends the whole
 * conversation every turn, so without a bound one request could carry a
 * fabricated history of megabytes — re-read on each of the turn's steps. The
 * browser already trims old photos (`withRecentPhotos`); this does the same on
 * the server, where a script cannot skip it, and adds:
 *
 * - **A message count and a character budget**, oldest dropped first. The
 *   latest message always stays: it is the question. A latest message that
 *   alone is over budget is refused, never silently cut.
 * - **Only inline photos.** A file part must be an image carried as a `data:`
 *   URL — what the chat composer sends. A remote URL would have the provider
 *   fetch whatever it names; a PDF or other file is never sent by the client
 *   (documents travel as an attachment id in the text).
 * - **A photo count** on the latest message; earlier messages keep the
 *   browser's {@link withRecentPhotos} allowance.
 *
 * Signed-in callers get a generous budget (an intake conversation over a batch
 * of equipment is long, and their requests are attributable); anonymous
 * callers a tight one.
 */

export interface HistoryBudget {
  maxMessages: number;
  /** Characters of everything but inline photo bytes, across the kept messages. */
  maxChars: number;
  /** Photos on the latest message. */
  maxLatestPhotos: number;
}

export const ANONYMOUS_HISTORY_BUDGET: HistoryBudget = { maxMessages: 30, maxChars: 60_000, maxLatestPhotos: 8 };
export const SIGNED_IN_HISTORY_BUDGET: HistoryBudget = { maxMessages: 200, maxChars: 400_000, maxLatestPhotos: 25 };

export function historyBudgetFor(role: Role): HistoryBudget {
  return role === "anonymous" ? ANONYMOUS_HISTORY_BUDGET : SIGNED_IN_HISTORY_BUDGET;
}

export type BoundedHistory =
  | { ok: true; messages: UIMessage[]; dropped: number }
  | { ok: false; reason: "invalid" | "too_long" };

export function boundChatHistory(raw: unknown, budget: HistoryBudget): BoundedHistory {
  if (!Array.isArray(raw)) return { ok: false, reason: "invalid" };
  const wellFormed = raw.filter(isUiMessage);
  if (wellFormed.length === 0) return { ok: false, reason: "invalid" };

  const cleaned = withRecentPhotos(wellFormed.map((message) => withInlinePhotosOnly(message)));
  const latest = cleaned[cleaned.length - 1];
  const capped = [...cleaned.slice(0, -1), capPhotos(latest, budget.maxLatestPhotos)];

  // Newest first, until the count or the budget runs out.
  let chars = 0;
  let start = capped.length;
  for (let i = capped.length - 1; i >= 0; i -= 1) {
    const size = textSize(capped[i]);
    if (capped.length - i > budget.maxMessages || chars + size > budget.maxChars) break;
    chars += size;
    start = i;
  }
  if (start === capped.length) return { ok: false, reason: "too_long" };

  // A conversation the model reads starts with the person, not mid-answer.
  while (start < capped.length - 1 && capped[start].role !== "user") start += 1;
  const messages = capped.slice(start);
  return { ok: true, messages, dropped: wellFormed.length - messages.length };
}

function isUiMessage(value: unknown): value is UIMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Partial<UIMessage>;
  return (
    (message.role === "user" || message.role === "assistant" || message.role === "system") &&
    Array.isArray(message.parts)
  );
}

function isFilePart(part: UIMessage["parts"][number]): part is FileUIPart {
  return part.type === "file";
}

/** A file part survives only as an inline image — what the composer sends. */
function withInlinePhotosOnly(message: UIMessage): UIMessage {
  if (!message.parts.some(isFilePart)) return message;
  return {
    ...message,
    parts: message.parts.filter(
      (part) =>
        !isFilePart(part) ||
        (typeof part.mediaType === "string" &&
          part.mediaType.startsWith("image/") &&
          typeof part.url === "string" &&
          part.url.startsWith("data:image/"))
    ),
  };
}

/** Keep the first `max` photos, every other part untouched. */
function capPhotos(message: UIMessage, max: number): UIMessage {
  let kept = 0;
  return {
    ...message,
    parts: message.parts.filter((part) => !isFilePart(part) || kept++ < max),
  };
}

/** The message's size without its photo bytes: the text, tool calls and results the model reads. */
function textSize(message: UIMessage): number {
  return JSON.stringify(message.parts.map((part) => (isFilePart(part) ? { type: "file" } : part))).length;
}
