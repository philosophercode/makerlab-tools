"use client";

/**
 * AI Elements `Message` / `MessageContent` / `MessageResponse`, copied from
 * registry.ai-sdk.dev/message.json (UI system spec §9; phase 5b) and cut to
 * what the chat uses — branches, actions and attachments are left out (they
 * would add `button-group` and draw controls the chat does not have).
 *
 * Local edits, per DESIGN.md §8.11:
 * - `Message` carries `data-role` (`user` / `assistant`) and an optional
 *   `data-kind` (`notice`, `error`) — what tests and styles select on, never a
 *   class name. `data-has-card` marks a message that holds a card, which
 *   takes the whole column.
 * - The user's turn is a square `secondary` block; the assistant's is unboxed
 *   prose. No rounded bubbles, no avatars.
 * - `MessageResponse` is streamdown with **raw HTML off**: the default rehype
 *   chain minus `raw` (so `sanitize` and `harden` still run), the link-safety
 *   modal and the copy/download controls off — model text is influenced by
 *   web pages and manuals, so it never renders as HTML (a tag shows as the
 *   text it is) — and plain elements (`MESSAGE_MARKDOWN`) drawn by the page's
 *   own Markdown rules (`MARKDOWN_PROSE`).
 */

import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown, defaultRehypePlugins, type StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils";
import { MARKDOWN_PROSE } from "../system/markdown-prose";
import { MESSAGE_MARKDOWN } from "./message-markdown";

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

/** streamdown's default rehype chain without `raw`: Markdown only, never HTML. */
const REHYPE_NO_RAW = [defaultRehypePlugins.sanitize, defaultRehypePlugins.harden];
const NO_LINK_SAFETY = { enabled: false } as const;

export type MessageResponseProps = Omit<StreamdownProps, "rehypePlugins" | "controls" | "linkSafety">;

export const MessageResponse = memo(
  ({ className, components, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(MARKDOWN_PROSE, "gap-2.5 text-sm", className)}
      controls={false}
      linkSafety={NO_LINK_SAFETY}
      rehypePlugins={REHYPE_NO_RAW}
      components={components ? { ...MESSAGE_MARKDOWN, ...components } : MESSAGE_MARKDOWN}
      {...props}
    />
  ),
  (prev, next) => prev.children === next.children && prev.components === next.components
);

MessageResponse.displayName = "MessageResponse";
