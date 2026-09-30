"use client";

/**
 * AI Elements `MessageResponse`, from registry.ai-sdk.dev/message.json (UI
 * system spec §9; phase 5b): an assistant turn's Markdown through streamdown.
 *
 * Its own module, apart from `Message` / `MessageContent`, because streamdown
 * is heavy (about 300 KB of script) and the chat is mounted in the root
 * layout: only `chat/ChatMessage` reaches it, through a lazy import, so a page
 * loads it when an answer is drawn, not on every visit.
 *
 * Local edits: **raw HTML off** — the default rehype chain minus `raw` (so
 * `sanitize` and `harden` still run), the link-safety modal and the
 * copy/download controls off — model text is influenced by web pages and
 * manuals, so it never renders as HTML (a tag shows as the text it is); and
 * plain elements (`MESSAGE_MARKDOWN`) drawn by the page's own Markdown rules
 * (`MARKDOWN_PROSE`).
 */

import { memo } from "react";
import { Streamdown, defaultRehypePlugins, type StreamdownProps } from "streamdown";
import { cn } from "@/lib/utils";
import { MARKDOWN_PROSE } from "../system/markdown-prose";
import { MESSAGE_MARKDOWN } from "./message-markdown";

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
