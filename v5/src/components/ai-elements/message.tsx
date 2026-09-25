"use client";

/**
 * AI Elements `Message` / `MessageContent` / `MessageResponse`, copied from
 * the registry (registry.ai-sdk.dev/message.json) and cut to what the spike
 * uses (UI system spec §8). Two deliberate differences from upstream:
 *
 * - `MessageResponse` renders with the app's existing `react-markdown` +
 *   `remark-gfm`, not `streamdown` — one Markdown renderer in the bundle until
 *   the chat phase decides between them (spec §8.3, open question).
 * - The user bubble is square and on the surface tier, per DESIGN.md.
 */

import type { UIMessage } from "ai";
import type { HTMLAttributes } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto items-end" : "is-assistant",
      className
    )}
    data-role={from}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "flex w-fit max-w-full min-w-0 flex-col gap-2 text-[14px] leading-relaxed",
      "group-[.is-user]:border group-[.is-user]:border-border group-[.is-user]:bg-secondary group-[.is-user]:px-3 group-[.is-user]:py-2",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = {
  children: string;
  components?: Components;
  className?: string;
};

export const MessageResponse = ({ children, components, className }: MessageResponseProps) => (
  <div className={cn("chat-markdown", className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </ReactMarkdown>
  </div>
);
