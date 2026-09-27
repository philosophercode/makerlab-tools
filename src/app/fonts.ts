import localFont from "next/font/local";

/**
 * The three typefaces of the Blueprint Archive, self-hosted (UI system spec
 * §6.2; owner decision 2026-09-25: no runtime request to Google Fonts).
 *
 * Before this, nothing loaded them: the page rendered in whatever the visitor
 * happened to have installed (Arial Narrow / Arial / Courier for most). The
 * files under `src/fonts/` are vendored so `next build` never needs the network
 * (Article 3). Each is the upstream variable font from google/fonts (all three
 * are SIL OFL 1.1 — licences beside them), limited to weights 400–700 (Inter
 * pinned to its default optical size) and subset to Latin, Latin Extended,
 * Cyrillic where the family has it, punctuation, arrows and the geometric
 * shapes the status glyphs use (● ▲ ■ ○ ◆). Scripts outside that set (CJK,
 * Arabic, Hebrew, Devanagari) fall through to the system fonts, as before.
 *
 * Each font only defines a CSS variable on <html>; `globals.css` builds
 * `--font-display` / `--font-body` / `--font-mono` from them, so every existing
 * rule picks the fonts up without being edited.
 */
export const spaceGrotesk = localFont({
  src: "../fonts/SpaceGrotesk-Variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-space-grotesk",
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

export const inter = localFont({
  src: "../fonts/Inter-Variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  fallback: ["Arial", "sans-serif"],
});

export const jetBrainsMono = localFont({
  src: "../fonts/JetBrainsMono-Variable.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono",
  fallback: ["SFMono-Regular", "Consolas", "monospace"],
});

/** The class names that define the three variables; set on <html>. */
export const fontVariables = [spaceGrotesk.variable, inter.variable, jetBrainsMono.variable].join(" ");
