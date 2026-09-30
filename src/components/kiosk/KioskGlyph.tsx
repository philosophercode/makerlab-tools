import { cn } from "@/lib/utils";

/**
 * `StatusGlyph`'s shapes at kiosk size (UI system spec §3 rule 4): the shape
 * carries the meaning as well as the colour, so a status still reads on a
 * washed-out TV or to somebody colour-blind across the room. Always beside a
 * word; decorative on its own.
 */
const GLYPH = { ok: "●", warn: "▲", bad: "■" } as const;
const INK = { ok: "text-ok", warn: "text-warn", bad: "text-bad" } as const;

export type KioskTone = keyof typeof GLYPH;

export function KioskGlyph({ tone, className }: { tone: KioskTone; className?: string }) {
  return (
    <span aria-hidden="true" data-tone={tone} className={cn("inline-block leading-none", INK[tone], className)}>
      {GLYPH[tone]}
    </span>
  );
}
