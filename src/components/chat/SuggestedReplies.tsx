"use client";

import { Suggestion, Suggestions } from "../ai-elements/suggestion";

/**
 * Suggested replies (assistant–GUI parity spec, amendment 2026-10-07
 * "Suggested replies"): the two or three short answers `suggest_replies`
 * offered, as a wrapping row of round bubbles under the latest answer. A tap
 * sends that text as the student's next message.
 *
 * The AI Elements `Suggestions` / `Suggestion` the starters use, laid out for
 * a few words each: a horizontal row that wraps on a phone instead of one
 * sentence per line. The bubbles are round — with the composer's controls,
 * the one exception to square corners (`.chat-reply-chip` in `globals.css`).
 * The row is a named group; each bubble is named by its text.
 *
 * `ChatPanel` decides when it shows (the latest assistant message, once the
 * turn has finished); this only draws it.
 */
export function SuggestedReplies({
  replies,
  label,
  onPick,
  disabled = false,
}: {
  replies: readonly string[];
  /** The group's accessible name, `chat.suggestedReplies`. */
  label: string;
  onPick: (reply: string) => void;
  disabled?: boolean;
}) {
  return (
    <Suggestions role="group" aria-label={label} data-kind="suggested-replies" className="flex-row flex-wrap items-center gap-2">
      {replies.map((reply) => (
        <Suggestion
          key={reply}
          suggestion={reply}
          onClick={onPick}
          disabled={disabled}
          className="chat-reply-chip max-w-full justify-center px-3.5 py-1.5 text-center text-foreground hover:border-primary-ink/60 hover:text-primary-ink"
        />
      ))}
    </Suggestions>
  );
}
