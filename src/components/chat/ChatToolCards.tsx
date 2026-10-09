"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ChatToolCard } from "../../lib/capabilities/tool-cards";
import { StatusGlyph } from "../system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "../ToolCard";
import { ToolImage } from "../ToolImage";

/** The plate is 72 CSS px; 2× covers a phone. */
const CARD_IMAGE_SIZES = "72px";

/**
 * The tools an answer is about (`data-tool-cards`, written by `show_tool`):
 * for each, the lab's own catalogue photo on its plate, the name, the category
 * and the status, the whole card a link to the tool's page. Opening it closes
 * the chat, as a tool link in the answer does.
 *
 * Every field was read from the catalogue by the server — the image is the
 * tool's own (its pre-rendered thumbnails, else the original through
 * `next/image`), never a URL the model wrote. A tool with no photo shows its
 * initials on the empty plate (`ToolImage`).
 */
export function ChatToolCards({ tools, onNavigate }: { tools: ChatToolCard[]; onNavigate?: () => void }) {
  const t = useTranslations("chat.toolCard");
  const tStatus = useTranslations("gallery.status");
  return (
    <ul data-kind="tool-cards" aria-label={t("label")} className="flex w-full flex-col gap-2">
      {tools.map((tool) => (
        <li key={tool.slug}>
          <Link
            href={`/tools/${tool.slug}`}
            onClick={onNavigate}
            data-slot="chat-tool-card"
            className="group/card flex items-center gap-3 border border-border bg-card p-2 transition-colors duration-150 hover:border-primary-ink/60"
          >
            <ToolImage
              src={tool.imageSrc}
              thumbnails={tool.thumbnails}
              name={tool.name}
              sizes={CARD_IMAGE_SIZES}
              className="size-[72px] shrink-0 p-1.5"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-heading text-sm leading-tight font-medium uppercase group-hover/card:text-primary-ink">
                {tool.name}
              </span>
              <span className="truncate font-mono text-label text-muted-foreground uppercase">{tool.category}</span>
              <StatusGlyph tone={TOOL_STATUS_TONE[tool.status]} label={tStatus(TOOL_STATUS_KEY[tool.status])} />
            </span>
            <span className="flex shrink-0 items-center gap-1 self-end font-mono text-label text-muted-foreground uppercase group-hover/card:text-primary-ink">
              <span className="sr-only sm:not-sr-only">{t("open")}</span>
              <ArrowRight aria-hidden="true" className="size-3.5 rtl:rotate-180" />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
