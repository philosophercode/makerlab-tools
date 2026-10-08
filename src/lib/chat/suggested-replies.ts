/**
 * Suggested replies (assistant–GUI parity spec, amendment 2026-10-07
 * "Suggested replies"): the two or three short answers the chat offers as
 * tappable bubbles under an answer that ends by asking the student to pick
 * between a few clear options ("Acrylic sign", "Engraved wood").
 *
 * The rules live here, pure and dependency-free, so both ends apply the same
 * limits: the `suggest_replies` capability when the model calls it, and the
 * chat again when it draws a message — a stored message is data, and nothing
 * in it becomes a bubble without passing these checks.
 */

export const SUGGEST_REPLIES_TOOL = "suggest_replies";

/** One bubble is not a choice. */
export const MIN_REPLIES = 2;
/** The owner asked for these sparingly, "when there's 2-3 choices easy to respond". */
export const MAX_REPLIES = 3;
/** A few words: a bubble on a 390 px phone holds about this much on one line. */
export const MAX_REPLY_LENGTH = 40;

/** Control characters, which become spaces (a newline is just a break between words). */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;
/**
 * Characters that change how text around them is drawn without being seen:
 * bidi embeddings, overrides and isolates, the zero-width space and the BOM.
 * The joiners (U+200C, U+200D) stay — Devanagari and emoji sequences use them.
 */
const INVISIBLE = /[​‪-‮⁦-⁩﻿]/g;

/** A reply as it is shown and sent: no control or invisible characters, one space between words, trimmed. */
export function cleanReply(text: string): string {
  return text.replace(CONTROL, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** What two replies are compared by: cleaned and case-insensitive. */
export function replyKey(text: string): string {
  return cleanReply(text).toLowerCase();
}

/** True when no two replies are the same, ignoring case and spacing. */
export function repliesAreDistinct(replies: readonly string[]): boolean {
  return new Set(replies.map(replyKey)).size === replies.length;
}

/**
 * The replies to offer, from whatever a part holds: each a string, cleaned,
 * 1–{@link MAX_REPLY_LENGTH} characters, the first of any repeat, at most
 * {@link MAX_REPLIES}. Fewer than {@link MIN_REPLIES} left means none.
 */
export function cleanReplies(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const replies: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const reply = cleanReply(value);
    if (!reply || reply.length > MAX_REPLY_LENGTH) continue;
    const key = reply.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    replies.push(reply);
    if (replies.length === MAX_REPLIES) break;
  }
  return replies.length >= MIN_REPLIES ? replies : [];
}

/** The `suggest_replies` tool part's type in a chat message. */
export const SUGGEST_REPLIES_PART = `tool-${SUGGEST_REPLIES_TOOL}`;

/**
 * The replies a message offers: the output of its last finished
 * `suggest_replies` call, checked again. A call still streaming, one that
 * failed validation, or one whose output is not `{ ok: true, replies }`
 * offers nothing.
 */
export function suggestedRepliesOf(parts: readonly unknown[]): string[] {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i] as { type?: unknown; state?: unknown; output?: unknown } | null;
    if (part?.type !== SUGGEST_REPLIES_PART || part.state !== "output-available") continue;
    const output = part.output as { ok?: unknown; replies?: unknown } | null | undefined;
    return output?.ok === true ? cleanReplies(output.replies) : [];
  }
  return [];
}
