import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One form field (DESIGN.md §8.7): the label above in mono 10px uppercase,
 * the control, then a 12px muted hint and, when there is one, the error in
 * `bad`. The caller renders the control and points it at the label (`id`) and
 * at the hint (`aria-describedby={hintId(id)}`), so any control — `Input`,
 * `Textarea`, `NativeSelect` — sits in the same frame.
 *
 * - `tone="warn"` is a field waiting on a person's decision (training left for
 *   staff to confirm): a warn-ink rule down its start edge, never colour alone
 *   — the hint says why.
 * - `updated` marks a field the last redo changed: `data-updated` for tests and
 *   a brief accent wash (off under reduced motion), and the caller puts the
 *   words ("Updated just now") in `marks`.
 */
export interface FieldProps {
  /** The control's id. */
  id: string;
  label: ReactNode;
  /** Beside the label: an "Updated just now" tag. */
  marks?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  tone?: "default" | "warn";
  updated?: boolean;
  className?: string;
  children: ReactNode;
}

/** The id a field's hint carries, for the control's `aria-describedby`. */
export function hintId(id: string): string {
  return `${id}-hint`;
}

export function Field({ id, label, marks, hint, error, tone = "default", updated = false, className, children }: FieldProps) {
  return (
    <div
      data-slot="field"
      data-updated={updated || undefined}
      className={cn(
        "ui flex min-w-0 flex-col gap-1",
        tone === "warn" && "border-s-2 border-s-warn ps-2",
        updated && "motion-safe:animate-[review-updated_4s_ease-out]",
        className
      )}
    >
      <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
        {label}
        {marks}
      </label>
      {children}
      {hint ? (
        <div id={hintId(id)} className="text-xs leading-snug text-muted-foreground">
          {hint}
        </div>
      ) : null}
      {error ? <p className="text-xs leading-snug text-bad">{error}</p> : null}
    </div>
  );
}
