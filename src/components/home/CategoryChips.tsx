"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { CategoryChip } from "../catalogue-view";

/**
 * The row of categories under the home page's search (student home spec,
 * amendment "One page: the list at rest"): **All**, then each top-level
 * category in the lab's order with its count. A chip is a toggle: pressed,
 * the list shows that category alone (the group comes to the top, so the
 * chip is also the way to jump to it); pressing it again, or **All**, shows
 * every group. It is the list's Category filter (`?category=`), drawn where a
 * student looks first.
 *
 * One line that scrolls sideways on a phone; it wraps from `sm` up. Category
 * names are data and stay English, as on the filter they replace.
 */
export function CategoryChips({
  chips,
  value,
  total,
  onChange,
}: {
  chips: readonly CategoryChip[];
  /** The chosen category, or null for all. */
  value: string | null;
  /** What All shows. */
  total: number;
  onChange: (value: string | null) => void;
}) {
  const t = useTranslations("gallery.chips");
  return (
    <div
      role="group"
      aria-label={t("label")}
      data-slot="category-chips"
      className="-mx-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      <Chip pressed={value === null} onClick={() => onChange(null)} label={t("all")} count={total} />
      {chips.map((chip) => (
        <Chip
          key={chip.name}
          pressed={value === chip.name}
          onClick={() => onChange(value === chip.name ? null : chip.name)}
          label={chip.name}
          count={chip.count}
        />
      ))}
    </div>
  );
}

function Chip({ pressed, onClick, label, count }: { pressed: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-slot="category-chip"
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 border px-3 font-mono text-label tracking-[0.06em] whitespace-nowrap uppercase transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        pressed
          ? "border-foreground bg-foreground text-background"
          : "border-input bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent"
      )}
    >
      <span>{label}</span>
      <span className={cn("tabular-nums", pressed ? "text-background/70" : "text-muted-foreground")}>{count}</span>
    </button>
  );
}
