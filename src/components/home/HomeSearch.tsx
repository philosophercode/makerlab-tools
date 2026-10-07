"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command as CommandPrimitive } from "cmdk";
import { LayoutGrid, MessageSquare } from "lucide-react";
import { Command, CommandGroup, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useChatLauncher } from "../ChatLauncherContext";
import { TOOL_STATUS_KEY } from "../ToolCard";
import { ToolImage } from "../ToolImage";
import type { HomeTool } from "./home-tools";
import {
  categoryEntries,
  categoryKeywords,
  rankByPaletteScore,
  toolKeywords,
  type CategoryEntry,
} from "../palette/palette-search";
import { SEARCH_INPUT_CLASS, SearchFrame, useSearchLines } from "../search/SearchFrame";
import { categoryHref } from "../../lib/gallery-links";

/** At most this many tools, then categories, under the box: the rest is one click away on the full list. */
export const HOME_SEARCH_TOOL_LIMIT = 6;
export const HOME_SEARCH_CATEGORY_LIMIT = 3;

/** cmdk's value for the "Ask MakerLAB AI" row. */
export const ASK_VALUE = "ask";

/**
 * The home page's smart search (student home spec 2026-10-07 §6): one box
 * for finding a machine and for asking MakerLAB AI.
 *
 * Typing lists matching **tools** first, then **categories** (each opens the
 * full list filtered to it), then, last, **Ask MakerLAB AI: “…”**, which opens
 * the chat with the text as the first message. Matching is the ⌘K palette's
 * (`palette-search.ts`, `paletteScore`): every word must appear, no fuzzy
 * guesses. It is the palette's search drawn inline, not a second one.
 *
 * **Enter opens the first match, and never asks by accident.** The first
 * tool or category is selected as you type; the Ask row is selected only by
 * moving to it (arrow keys or the pointer). When nothing matches, nothing is
 * selected and Enter does nothing, so a question reaches the model only when
 * somebody chose to send it.
 */
export function HomeSearch({ tools, toolCount }: { tools: readonly HomeTool[]; toolCount: number }) {
  const t = useTranslations("gallery.search");
  const tStatus = useTranslations("gallery.status");
  const router = useRouter();
  const { open: openChat } = useChatLauncher();
  const lines = useSearchLines(toolCount);

  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // The row somebody moved to, for the query they moved on. A new query
  // starts again from its first match.
  const [moved, setMoved] = useState<{ query: string; value: string } | null>(null);
  // Only a person moves the selection: arrow keys, Home/End or the pointer.
  // cmdk also selects rows on its own as they mount, which must never land on Ask.
  const choosing = useRef(false);
  // cmdk selects a row by itself when the text changes (its first row) and
  // keeps that choice internally. When that row is Ask and nobody chose it,
  // the value handed back changes ("nothing" with a new number), which makes
  // cmdk drop its own choice and show none.
  const [resync, setResync] = useState(0);

  const trimmed = query.trim();
  const categories = useMemo(() => categoryEntries(tools), [tools]);
  const toolMatches = useMemo(() => rankByPaletteScore(tools, trimmed, toolKeywords, HOME_SEARCH_TOOL_LIMIT), [tools, trimmed]);
  const categoryMatches = useMemo(
    () => rankByPaletteScore(categories, trimmed, categoryKeywords, HOME_SEARCH_CATEGORY_LIMIT),
    [categories, trimmed]
  );

  const firstMatch = toolMatches[0] ? toolValue(toolMatches[0]) : categoryMatches[0] ? categoryValue(categoryMatches[0]) : "";
  const selected = moved && moved.query === trimmed ? moved.value : firstMatch;
  const showList = listOpen && trimmed !== "";

  function reset() {
    setQuery("");
    setMoved(null);
    setListOpen(false);
  }

  function go(href: string) {
    reset();
    router.push(href);
  }

  function ask() {
    if (!trimmed) return;
    const question = trimmed;
    reset();
    openChat(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (NAVIGATION_KEYS.has(event.key) || (event.ctrlKey && (event.key === "n" || event.key === "p" || event.key === "j" || event.key === "k"))) {
      choosing.current = true;
    }
    if (event.key === "Escape") {
      if (showList) setListOpen(false);
      else if (query) setQuery("");
      return;
    }
    if (event.key === "Enter" && !selected) {
      // Nothing matches and nothing was chosen: stay put (cmdk would do nothing either).
      event.preventDefault();
      return;
    }
    if (!showList && (event.key === "ArrowDown" || event.key === "ArrowUp") && trimmed) setListOpen(true);
  }

  return (
    <div role="search" aria-label={t("landmark")} className="w-full" data-slot="home-search">
      <Command
        label={t("label")}
        shouldFilter={false}
        loop
        value={selected || `${NOTHING_SELECTED}${resync}`}
        onValueChange={(value) => {
          if (choosing.current) setMoved({ query: trimmed, value });
          else if (value !== selected) setResync((count) => count + 1);
        }}
        onKeyDown={onKeyDown}
        className="relative overflow-visible bg-transparent"
      >
        <SearchFrame lines={lines} empty={query === ""} focused={focused}>
          <CommandPrimitive.Input
            value={query}
            onValueChange={(value) => {
              choosing.current = false;
              setQuery(value);
              setListOpen(true);
            }}
            onFocus={() => {
              setFocused(true);
              setListOpen(true);
            }}
            onBlur={() => {
              setFocused(false);
              setListOpen(false);
            }}
            aria-describedby={undefined}
            data-slot="home-search-input"
            className={SEARCH_INPUT_CLASS}
          />
        </SearchFrame>

        {/* Kept in the DOM, hidden while closed, so the input's aria-controls always names it. */}
        <CommandList
          hidden={!showList}
          // A press on a row must not blur the input first, or the list would close under the pointer.
          onMouseDown={(event) => event.preventDefault()}
          onPointerMove={() => {
            choosing.current = true;
          }}
          className={cn(
            "absolute inset-x-0 top-full z-30 mt-1 max-h-[min(70vh,520px)] border border-border bg-popover p-1 text-start shadow-lg",
            !showList && "hidden"
          )}
        >
          {toolMatches.length > 0 ? (
            <CommandGroup heading={t("tools")}>
              {toolMatches.map((tool) => (
                <CommandItem key={tool.id} value={toolValue(tool)} onSelect={() => go(`/tools/${tool.slug}`)} className="gap-3 py-2">
                  <ToolImage
                    src={tool.imageSrc}
                    thumbnails={tool.thumbnails}
                    name={tool.name}
                    sizes="40px"
                    className="size-10 shrink-0 bg-muted p-1"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{tool.name}</span>
                    {tool.officialName && tool.officialName !== tool.name ? (
                      <span className="truncate text-xs text-muted-foreground">{tool.officialName}</span>
                    ) : null}
                  </span>
                  <CommandShortcut className="hidden sm:inline">{tStatus(TOOL_STATUS_KEY[tool.status])}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {categoryMatches.length > 0 ? (
            <CommandGroup heading={t("categories")}>
              {categoryMatches.map((category) => (
                <CommandItem
                  key={category.name}
                  value={categoryValue(category)}
                  onSelect={() => go(categoryHref(category.name))}
                  className="gap-3 py-2"
                >
                  <LayoutGrid aria-hidden="true" className="ms-3 me-3" />
                  <span className="truncate text-sm">{category.name}</span>
                  <CommandShortcut>{t("categoryCount", { count: category.count })}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {toolMatches.length === 0 && categoryMatches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground" data-slot="home-search-none">
              {t("noMatch", { query: trimmed })}
            </p>
          ) : null}

          <CommandGroup heading={t("assistant")} className="border-t border-border">
            <CommandItem value={ASK_VALUE} onSelect={ask} className="items-start gap-3 py-2">
              <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center bg-primary text-primary-foreground">
                <MessageSquare className="size-4 text-primary-foreground" />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm break-words text-foreground">{t("ask", { query: trimmed })}</span>
                <span className="text-xs text-muted-foreground">{t("askNote")}</span>
              </span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  );
}

/** What cmdk is given when no row is chosen: no row has this value, and it is not empty, so cmdk does not pick one. */
const NOTHING_SELECTED = "none:";

const NAVIGATION_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

function toolValue(tool: HomeTool): string {
  return `tool:${tool.id}`;
}

function categoryValue(category: CategoryEntry): string {
  return `category:${category.name}`;
}
