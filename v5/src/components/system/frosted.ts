/**
 * The frosted plate (DESIGN.md §3 "Frosted surface"; public polish): the
 * classes for a panel that floats over a moving page — the profile menu and
 * the ⌘K palette. A solid card by default; where the browser can blur, the
 * mostly-opaque `--surface-frosted` with blur and a little saturation, so the
 * page behind reads as texture and never as text. A hairline control
 * boundary, no shadow (the global rule), light and dark through the tokens.
 */
export const FROSTED =
  "border border-input bg-card supports-[backdrop-filter:blur(1px)]:bg-(--surface-frosted) supports-[backdrop-filter:blur(1px)]:backdrop-blur-[16px] supports-[backdrop-filter:blur(1px)]:backdrop-saturate-[1.4]";
