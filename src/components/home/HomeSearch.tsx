"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Command as CommandPrimitive } from "cmdk";
import { CornerDownLeft, LayoutGrid, MessageSquare } from "lucide-react";
import { Command, CommandGroup, CommandItem, CommandList, CommandShortcut } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useChatLauncher } from "../ChatLauncherContext";
import { categoryKeywords, rankByPaletteScore, type CategoryEntry } from "../palette/palette-search";
import { SEARCH_INPUT_CLASS, SearchFrame, useSearchLines } from "../search/SearchFrame";

/** At most this many categories under the box. */
export const HOME_SEARCH_CATEGORY_LIMIT = 3;

/** cmdk's value for the "Ask MakerLAB AI" row. */
export const ASK_VALUE = "ask";

export interface HomeSearchProps {
  /** The text, which lives in the URL (`?q=`): the list below shows its matches. */
  value: string;
  onChange: (value: string) => void;
  /** The categories, for the rows that match the text. */
  categories: readonly CategoryEntry[];
  /** The first tool the list shows for the text: what Enter opens. */
  firstResult: { name: string; slug: string } | null;
  /** A category row was chosen: the list filtered to it. */
  onCategory: (name: string) => void;
  /** For the placeholder's "Search 77 tools". */
  toolCount: number;
}

/**
 * The home page's search (student home spec 2026-10-07 §6, amendment "One
 * page: the list at rest"): one box for finding a machine and for asking
 * MakerLAB AI.
 *
 * **The matching tools are the page.** What is typed goes to the URL, and the
 * list under the box swaps its groups for the matching tools, ranked by the
 * ⌘K palette's matcher, as you type; emptying the box brings the groups back.
 * So the list under the box keeps only what the page cannot show: the
 * **categories** the text matches (each filters the list to itself) and,
 * last, **Ask MakerLAB AI: “…”**, which opens the chat with the text as the
 * first message.
 *
 * **Enter opens the first result, and never asks by accident.** Nothing in
 * the list is selected until somebody moves to it (arrow keys or the
 * pointer). Enter with nothing selected opens the first tool the page shows,
 * else the first matching category, else does nothing — so a question reaches
 * the model only when somebody chose the Ask row.
 */
export function HomeSearch({ value, onChange, categories, firstResult, onCategory, toolCount }: HomeSearchProps) {
  const t = useTranslations("gallery.search");
  const router = useRouter();
  const { open: openChat } = useChatLauncher();
  const lines = useSearchLines(toolCount);
  const inputRef = useRef<HTMLInputElement>(null);

  const [focused, setFocused] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // The row somebody moved to, for the text they moved on. New text starts
  // again with nothing selected.
  const [moved, setMoved] = useState<{ query: string; value: string } | null>(null);
  // Only a person moves the selection: arrow keys, Home/End or the pointer.
  // cmdk also selects rows on its own as they mount, which must never stick.
  const choosing = useRef(false);
  // cmdk selects a row by itself when the text changes (its first row) and
  // keeps that choice internally. When nobody chose it, the value handed back
  // changes ("nothing" with a new number), which makes cmdk drop its own
  // choice and show none.
  const [resync, setResync] = useState(0);

  const trimmed = value.trim();
  const categoryMatches = useMemo(
    () => rankByPaletteScore(categories, trimmed, categoryKeywords, HOME_SEARCH_CATEGORY_LIMIT),
    [categories, trimmed]
  );
  const selected = moved && moved.query === trimmed ? moved.value : "";
  const showList = listOpen && trimmed !== "";

  function close() {
    setMoved(null);
    setListOpen(false);
  }

  function openTool(slug: string) {
    // The text stays in the URL: Back returns to these results.
    close();
    router.push(`/tools/${slug}`);
  }

  function chooseCategory(name: string) {
    close();
    onCategory(name);
  }

  function ask() {
    if (!trimmed) return;
    const question = trimmed;
    close();
    onChange("");
    openChat(question);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (NAVIGATION_KEYS.has(event.key) || (event.ctrlKey && (event.key === "n" || event.key === "p" || event.key === "j" || event.key === "k"))) {
      choosing.current = true;
    }
    if (event.key === "Escape") {
      if (showList) setListOpen(false);
      else if (value) onChange("");
      return;
    }
    // An input method's Enter confirms the composed text (Japanese, Chinese, Korean): never a choice.
    if (event.key === "Enter" && (event.nativeEvent.isComposing || event.keyCode === 229)) return;
    if (event.key === "Enter" && !(showList && selected)) {
      // Nothing chosen in the list: the first result, else the first category, else nothing.
      event.preventDefault();
      if (!trimmed) return;
      if (firstResult) openTool(firstResult.slug);
      else if (categoryMatches[0]) chooseCategory(categoryMatches[0].name);
      return;
    }
    if (!showList && (event.key === "ArrowDown" || event.key === "ArrowUp") && trimmed) setListOpen(true);
  }

  const enterTarget = firstResult?.name ?? categoryMatches[0]?.name ?? null;

  return (
    <div role="search" aria-label={t("landmark")} className="w-full" data-slot="home-search">
      <Command
        label={t("label")}
        shouldFilter={false}
        loop
        value={selected || `${NOTHING_SELECTED}${resync}`}
        onValueChange={(next) => {
          if (choosing.current) setMoved({ query: trimmed, value: next });
          else if (next !== selected) setResync((count) => count + 1);
        }}
        onKeyDown={onKeyDown}
        className="relative overflow-visible bg-transparent"
      >
        <SearchFrame
          lines={lines}
          empty={value === ""}
          focused={focused}
          clear={{
            label: t("clear"),
            onClear: () => {
              close();
              onChange("");
              inputRef.current?.focus();
            },
          }}
        >
          <CommandPrimitive.Input
            ref={inputRef}
            value={value}
            onValueChange={(next) => {
              choosing.current = false;
              onChange(next);
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
            className={cn(SEARCH_INPUT_CLASS, "pe-14")}
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
            "absolute inset-x-0 top-full z-30 mt-1 max-h-[min(60vh,420px)] border border-border bg-popover p-1 text-start shadow-lg",
            !showList && "hidden"
          )}
        >
          {enterTarget ? (
            <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground" data-slot="home-search-enter">
              <kbd aria-hidden="true" className="inline-flex items-center border border-border px-1 py-0.5 font-mono text-micro">
                <CornerDownLeft className="size-3" />
              </kbd>
              <span className="truncate">{t("enterOpens", { name: enterTarget })}</span>
            </p>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground" data-slot="home-search-none">
              {t("noMatch", { query: trimmed })}
            </p>
          )}

          {categoryMatches.length > 0 ? (
            <CommandGroup heading={t("categories")} className="border-t border-border">
              {categoryMatches.map((category) => (
                <CommandItem
                  key={category.name}
                  value={categoryValue(category)}
                  onSelect={() => chooseCategory(category.name)}
                  className="gap-3 py-2"
                >
                  <LayoutGrid aria-hidden="true" className="ms-3 me-3" />
                  <span className="truncate text-sm">{category.name}</span>
                  <CommandShortcut>{t("categoryCount", { count: category.count })}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
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

function categoryValue(category: CategoryEntry): string {
  return `category:${category.name}`;
}
