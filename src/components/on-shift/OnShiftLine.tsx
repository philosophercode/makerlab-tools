import { cn } from "@/lib/utils";

/**
 * The one look of the on-shift line (on-shift spec 2026-10-07 §6): the live
 * dot the header's status strip uses, then the sentence, in the mono label
 * type of a facts line. Presentational only; `OnShiftNow` decides whether
 * there is anything to say.
 */
export function OnShiftLine({ text, className }: { text: string; className?: string }) {
  return (
    <p
      data-slot="on-shift-now"
      className={cn("flex items-baseline gap-2 font-mono text-label tracking-[0.04em] text-foreground uppercase", className)}
    >
      <i className="live-dot shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}
