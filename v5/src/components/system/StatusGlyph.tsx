import { cn } from "@/lib/utils";

/**
 * Status as a small glyph plus a word (UI system spec §4 rule 4, DESIGN.md
 * "Status glyphs"). The glyph's **shape** carries the meaning as well as its
 * colour, so the status survives greyscale, colour blindness and a photocopy;
 * the word is always there (visually, or for a screen reader when `compact`).
 *
 * Six tones, and no others:
 * - `ok`     ● a settled, good state (published, available, searchable)
 * - `warn`   ▲ needs a person soon (never reviewed, no manual, medium)
 * - `bad`    ■ broken or urgent (failed, out of service, critical)
 * - `idle`   ○ nothing to do / not started (draft, queued, none)
 * - `active` ◆ the accent: waiting on *you* (proposed, researched, new)
 * - `muted`  – archived, retired, decided
 */
export type StatusTone = "ok" | "warn" | "bad" | "idle" | "active" | "muted";

const GLYPH: Record<StatusTone, string> = {
  ok: "●",
  warn: "▲",
  bad: "■",
  idle: "○",
  active: "◆",
  muted: "–",
};

const COLOR: Record<StatusTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  idle: "text-muted-foreground",
  active: "text-primary-ink",
  muted: "text-muted-foreground/70",
};

export interface StatusGlyphProps {
  tone: StatusTone;
  label: string;
  /** Glyph only; the word goes to `title` and to screen readers. For dense cells. */
  compact?: boolean;
  className?: string;
}

export function StatusGlyph({ tone, label, compact = false, className }: StatusGlyphProps) {
  return (
    <span
      className={cn("inline-flex items-baseline gap-1.5 font-mono text-[11px] leading-none tracking-[0.04em] uppercase", className)}
      title={compact ? label : undefined}
      data-tone={tone}
    >
      <span aria-hidden="true" className={cn("text-[10px]", COLOR[tone])}>
        {GLYPH[tone]}
      </span>
      {compact ? <span className="sr-only">{label}</span> : <span className={tone === "muted" ? "text-muted-foreground" : undefined}>{label}</span>}
    </span>
  );
}

/** The glyph alone, decorative — for when the word is already beside it. */
export function Glyph({ tone, className }: { tone: StatusTone; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-block w-[1.2em] text-[10px]", COLOR[tone], className)}>
      {GLYPH[tone]}
    </span>
  );
}
