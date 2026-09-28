/**
 * The kiosk's type scale, in `vmin` so one design reads the same on a 1080p
 * TV across the lab and an iPad at arm's length (kiosk spec §6), clamped so a
 * small window stays legible and a 4K panel does not shout. Labels are never
 * below ~18px on a 1080p screen.
 */
export const KIOSK_TYPE = {
  /** Section labels: mono, uppercase, tracked. */
  label: "font-mono uppercase tracking-[0.12em] text-[clamp(14px,1.9vmin,28px)] leading-tight text-muted-foreground",
  /** Secondary lines. */
  small: "text-[clamp(14px,2.2vmin,32px)] leading-snug",
  /** Body lines and card titles. */
  body: "text-[clamp(16px,2.8vmin,40px)] leading-tight",
  /** Panel headlines ("All machines running"). */
  headline: "font-heading uppercase text-[clamp(22px,5vmin,72px)] leading-none",
  /** The open-ticket figure. */
  figure: "font-heading text-[clamp(56px,15vmin,220px)] leading-[0.85] tabular-nums",
  /** The clock. */
  clock: "font-mono text-[clamp(22px,5.2vmin,80px)] leading-none tabular-nums",
} as const;
