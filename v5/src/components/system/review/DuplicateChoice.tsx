"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Glyph, StatusGlyph } from "../StatusGlyph";

/**
 * "This is a duplicate of X" and what to do about it (UI system spec §7.2,
 * §4.3): one control where there were three — the chat table's buttons, the
 * import review's `<select>` and the queue's buttons.
 *
 * - **Radio semantics.** A `radiogroup` of `radio`s, so the choice made is
 *   announced as the one checked. Each radio is its own tab stop and chooses
 *   on Space, Enter or a click — the arrow keys do **not** move the choice, as
 *   a native radio group's would, because choosing here *saves*: an arrow key
 *   passing over "Remove" must not remove the row.
 * - **The match is said first**, with a ▲ glyph, and is the group's
 *   description, so a screen reader hears what the choice is about.
 * - **Decided and final** (`resolved`): the choice is shown as a settled
 *   status, not as controls — the chat table cannot un-decide a duplicate.
 * - `children` is where a choice that needs one more answer asks it (the
 *   serial number of another unit), under the options.
 *
 * Controlled and stateless: the caller saves on `onChoose` and passes the
 * saved (or pending) value back.
 */

export interface DuplicateChoiceOption<V extends string = string> {
  value: V;
  label: string;
  /** A fuller name for the radio when the label alone would repeat across rows ("Add Form 4 as another unit"). */
  ariaLabel?: string;
}

export interface DuplicateChoiceProps<V extends string = string> {
  /** The group's accessible name ("What to do about Form 4's match"). */
  label: string;
  /** What it matched, as a sentence (may hold a link to the matched tool). */
  match: ReactNode;
  /** Id for the match sentence, so another control can point at it (`aria-describedby`). */
  matchId?: string;
  options: readonly DuplicateChoiceOption<V>[];
  /** The checked option: the saved decision, or the one being confirmed. */
  value: V | null;
  onChoose: (value: V) => void;
  disabled?: boolean;
  /** Decided and not to be changed here: the decision in words. */
  resolved?: string | null;
  /** The decision's glyph: ● a decision made (default), ▲ one still owed that cannot be made here. */
  resolvedTone?: "ok" | "warn" | "muted";
  /** Placed under the options: a follow-up the chosen option needs. */
  children?: ReactNode;
  className?: string;
}

export function DuplicateChoice<V extends string>({
  label,
  match,
  matchId,
  options,
  value,
  onChoose,
  disabled = false,
  resolved = null,
  resolvedTone = "ok",
  children,
  className,
}: DuplicateChoiceProps<V>) {
  return (
    <div data-slot="duplicate-choice" className={cn("ui flex min-w-0 flex-col gap-1.5 text-table", className)}>
      <p id={matchId} className="flex items-baseline gap-1.5 whitespace-normal">
        <Glyph tone="warn" />
        <span>{match}</span>
      </p>
      {resolved ? (
        <StatusGlyph tone={resolvedTone} label={resolved} className="font-sans text-table normal-case" />
      ) : (
        <div
          role="radiogroup"
          aria-label={label}
          aria-describedby={matchId}
          aria-disabled={disabled || undefined}
          className="flex flex-wrap gap-1"
        >
          {options.map((option) => {
            const checked = value === option.value;
            return (
              <Button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-label={option.ariaLabel}
                size="xs"
                variant={checked ? "outline" : "quiet"}
                disabled={disabled}
                className={cn(checked && "border-primary-ink bg-primary/10")}
                onClick={() => {
                  if (!checked) onChoose(option.value);
                }}
              >
                {option.label}
              </Button>
            );
          })}
        </div>
      )}
      {children}
    </div>
  );
}
