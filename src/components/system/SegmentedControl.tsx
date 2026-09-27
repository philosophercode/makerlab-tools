"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A segmented control (DESIGN.md §8.10): two to four mutually exclusive
 * choices that are the same thing seen differently — the gallery's Grid /
 * Table view. **Every segment is always outlined** (the unchosen ones in the
 * control-boundary ink, `--outline-strong`), the segments share their borders
 * and are the same size, and the chosen one is filled in ink — so the control
 * never looks half-missing, which the old two separate buttons did.
 *
 * A `group` of toggle buttons with `aria-pressed`, not a radio group: each
 * segment is its own tab stop and acts on Enter or Space, like every other
 * button in the bar, and a choice that loads a URL is not a form value.
 */
export interface SegmentOption<V extends string> {
  value: V;
  /** The segment's accessible name (and tooltip). */
  label: string;
  /** Icon or short text shown in the segment. */
  content: ReactNode;
}

export interface SegmentedControlProps<V extends string> {
  /** The group's accessible name ("View"). */
  label: string;
  value: V;
  options: SegmentOption<V>[];
  onChange: (value: V) => void;
  className?: string;
}

export function SegmentedControl<V extends string>({ label, value, options, onChange, className }: SegmentedControlProps<V>) {
  return (
    <div role="group" aria-label={label} data-slot="segmented-control" className={cn("ui inline-flex", className)}>
      {options.map((option, index) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={chosen}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative inline-flex size-7 cursor-pointer items-center justify-center border border-input transition-colors duration-150",
              "focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
              "[&_svg]:pointer-events-none [&_svg]:size-3.5",
              index > 0 && "-ms-px",
              chosen
                ? "z-[1] border-foreground bg-foreground text-background"
                : "bg-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}
