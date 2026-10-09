"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRotatingLine } from "./use-rotating-line";

/**
 * The input inside a `SearchFrame`: the frame draws the border, the icon and
 * the placeholder line, so the input itself is bare.
 */
export const SEARCH_INPUT_CLASS =
  "h-full w-full min-w-0 bg-transparent ps-12 pe-4 text-base text-foreground outline-hidden sm:text-lg [&::-webkit-search-cancel-button]:hidden";

/**
 * The lines the placeholder rotates through (student home spec 2026-10-07
 * §6, the owner's addendum): the four prompts the addendum names, the live
 * tool count among them, then two real questions. The first is the one that
 * shows under reduced motion, so it is the plainest.
 */
export function useSearchLines(toolCount: number): string[] {
  const t = useTranslations("gallery.search.lines");
  return [
    t("search", { count: toolCount }),
    t("build"),
    t("x1Start"),
    t("findMachine"),
    t("x1Filament"),
    t("trotecAcrylic"),
  ];
}

/**
 * The minimal search box (owner decision 2026-10-07): one tall field, a
 * search icon, and a placeholder line that fades from one prompt to the next
 * about every three seconds. The line is drawn over the field rather than as
 * its `placeholder`, so a screen reader hears the field's steady label, not a
 * new sentence every three seconds. It holds still while the field has focus
 * or text, and under reduced motion.
 *
 * The caller supplies the input (a plain search input on the full list, the
 * combobox input of `HomeSearch` on the home page) with `SEARCH_INPUT_CLASS`.
 */
export function SearchFrame({
  children,
  lines,
  empty,
  focused,
  className,
  clear,
}: {
  children: ReactNode;
  lines: readonly string[];
  /** The field has no text: the placeholder line shows. */
  empty: boolean;
  /** The field has focus: the line stops on the one showing. */
  focused: boolean;
  className?: string;
  /**
   * Empties the field: an × at its end while it has text. The home page's
   * box has it, since emptying the box brings the list back.
   */
  clear?: { label: string; onClear: () => void };
}) {
  const { index, visible } = useRotatingLine(lines.length, { paused: focused || !empty });
  return (
    <div
      data-slot="search-frame"
      className={cn(
        "relative flex h-14 w-full items-center border border-foreground/70 bg-card transition-colors duration-150 sm:h-16",
        "focus-within:border-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring focus-within:outline-solid",
        className
      )}
    >
      <Search aria-hidden="true" className="pointer-events-none absolute start-4 size-5 text-muted-foreground" />
      {children}
      {empty ? (
        <span
          aria-hidden="true"
          data-slot="search-line"
          className={cn(
            "pointer-events-none absolute inset-y-0 start-12 end-4 flex items-center truncate text-base text-muted-foreground sm:text-lg",
            "motion-safe:transition-opacity motion-safe:duration-300",
            visible ? "opacity-100" : "opacity-0"
          )}
        >
          <span className="truncate">{lines[index]}</span>
        </span>
      ) : clear ? (
        <button
          type="button"
          aria-label={clear.label}
          title={clear.label}
          data-slot="search-clear"
          // Keep the focus in the field: a press must not blur it first.
          onMouseDown={(event) => event.preventDefault()}
          onClick={clear.onClear}
          className="absolute end-2 inline-flex size-10 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring focus-visible:outline-solid"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      ) : null}
    </div>
  );
}
