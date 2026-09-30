import { cn } from "@/lib/utils";

/**
 * Status as a small glyph plus a word (UI system spec §3 rule 4; DESIGN.md
 * §8.5). The glyph's **shape** carries the meaning as well as its colour, so a
 * status survives greyscale, colour blindness and a photocopy; the word is
 * always there — visibly, or for a screen reader when `compact`.
 *
 * Six tones, and no others:
 * - `ok`     ● settled and good (published, available, searchable, verified)
 * - `warn`   ▲ needs a person soon (never reviewed, no manual, medium)
 * - `bad`    ■ broken or urgent (failed, out of service, critical)
 * - `idle`   ○ nothing to do / not started (draft, queued, none)
 * - `active` ◆ the accent: waiting on *you* (proposed, researched, new)
 * - `muted`  – archived, retired, decided
 *
 * The caller passes the word already translated.
 */
export type StatusTone = "ok" | "warn" | "bad" | "idle" | "active" | "muted";

export const STATUS_TONES: readonly StatusTone[] = ["ok", "warn", "bad", "idle", "active", "muted"];

const GLYPH: Record<StatusTone, string> = {
  ok: "●",
  warn: "▲",
  bad: "■",
  idle: "○",
  active: "◆",
  muted: "–",
};

const INK: Record<StatusTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  idle: "text-idle",
  active: "text-primary-ink",
  muted: "text-muted-foreground",
};

export interface StatusGlyphProps {
  tone: StatusTone;
  /** The status word, translated. Always rendered: visibly, or `sr-only` when compact. */
  label: string;
  /** Glyph only on screen, for dense cells; the word stays for screen readers and as a tooltip. */
  compact?: boolean;
  className?: string;
}

export function StatusGlyph({ tone, label, compact = false, className }: StatusGlyphProps) {
  return (
    <span
      data-tone={tone}
      title={compact ? label : undefined}
      className={cn("inline-flex items-baseline gap-1.5 font-mono text-label leading-none uppercase", className)}
    >
      <Glyph tone={tone} />
      <span className={cn(compact && "sr-only", tone === "muted" && "text-muted-foreground")}>{label}</span>
    </span>
  );
}

/** The glyph alone, decorative — only where the word is already beside it. */
export function Glyph({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span aria-hidden="true" data-glyph={tone} className={cn("inline-block text-micro", INK[tone], className)}>
      {GLYPH[tone]}
    </span>
  );
}
