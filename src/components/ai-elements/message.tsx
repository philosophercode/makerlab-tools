"use client";

/**
 * AI Elements `Message` / `MessageContent`, copied from
 * registry.ai-sdk.dev/message.json (UI system spec §9; phase 5b) and cut to
 * what the chat uses — branches, actions and attachments are left out (they
 * would add `button-group` and draw controls the chat does not have).
 * `MessageResponse` (streamdown) is `message-response.tsx`, loaded lazily.
 *
 * Local edits, per DESIGN.md §8.11:
 * - `Message` carries `data-role` (`user` / `assistant`) and an optional
 *   `data-kind` (`notice`, `error`) — what tests and styles select on, never a
 *   class name. `data-has-card` marks a message that holds a card, which
 *   takes the whole column.
 * - The user's turn is a square `secondary` block; the assistant's is unboxed
 *   prose. No rounded bubbles, no avatars.
 */

import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
  /** A message that is not a plain turn: a notice (the allowance ceiling) or a failure. */
  kind?: "notice" | "error";
  /** The message holds a card (intake table, proposals, import); it takes the column. */
  hasCard?: boolean;
};

export const Message = ({ className, from, kind, hasCard = false, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user" ? "is-user ms-auto max-w-[88%] items-end" : "is-assistant",
      from !== "user" && !hasCard && "max-w-full",
      className
    )}
    data-role={from}
    data-kind={kind}
    data-has-card={hasCard || undefined}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-full max-w-full min-w-0 flex-col gap-3 text-sm leading-relaxed",
      "group-[.is-user]:w-fit group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:bg-secondary group-[.is-user]:px-3 group-[.is-user]:py-2 group-[.is-user]:whitespace-pre-wrap",
      "group-[.is-assistant]:text-foreground",
      "group-data-[kind=error]:border-s-2 group-data-[kind=error]:border-s-bad group-data-[kind=error]:ps-3 group-data-[kind=error]:text-bad",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
