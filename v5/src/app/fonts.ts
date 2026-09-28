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
 * **Each family is two files, split by `unicode-range`** (performance): a
 * Latin face (`<Family>-Latin.woff2`: Basic Latin, Latin-1, punctuation,
 * arrows, the status shapes and the UI's ⌘ ↻ ⇧ ✓ ✕) that every page preloads,
 * and an Extended face (`<Family>-Extended.woff2`: Latin Extended, Cyrillic,
 * currency, letterlike symbols) that the browser downloads only when a page
 * shows one of those characters — Turkish or Russian text, say. The Latin
 * faces are ~40% of the full files, which were three of the largest requests
 * on every first load. Both are cut from `<Family>-Variable.woff2` with
 * fontTools (`pyftsubset --flavor=woff2 --layout-features='*'`, the Latin set
 * below, and the rest of the file's characters for Extended), keeping the
 * original metrics so nothing reflows.
 *
 * Each face only defines a CSS variable on <html>; `globals.css` builds
 * `--font-display` / `--font-body` / `--font-mono` as "Latin face, then
 * Extended face, then the metric-matched fallback", so every existing rule
 * picks the fonts up without being edited. The Latin face carries no fallback
 * of its own — a fallback there would catch Cyrillic before the Extended face
 * could.
 */

// next/font's options must be literals in each call (its compiler reads them),
// so the two unicode-range strings are repeated rather than shared:
//
// Latin faces:    U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2190-2199, U+21BB, U+21E7, U+2212, U+2215, U+2318, U+25A0-25FF, U+2713, U+2715, U+FEFF, U+FFFD
// Extended faces: U+0100-02FF, U+0400-04FF, U+1E00-1EFF, U+2070-209F, U+20A0-20CF, U+2100-214F, U+2190-23FF, U+2C60-2C7F, U+A720-A7FF (broad on purpose: the Latin face is consulted first)

export const spaceGroteskLatin = localFont({
  src: "../fonts/SpaceGrotesk-Latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-space-grotesk-latin",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2190-2199, U+21BB, U+21E7, U+2212, U+2215, U+2318, U+25A0-25FF, U+2713, U+2715, U+FEFF, U+FFFD" }],
  fallback: [],
  adjustFontFallback: false,
});

export const spaceGrotesk = localFont({
  src: "../fonts/SpaceGrotesk-Extended.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-space-grotesk",
  declarations: [{ prop: "unicode-range", value: "U+0100-02FF, U+0400-04FF, U+1E00-1EFF, U+2070-209F, U+20A0-20CF, U+2100-214F, U+2190-23FF, U+2C60-2C7F, U+A720-A7FF" }],
  preload: false,
  fallback: ["Arial Narrow", "Arial", "sans-serif"],
});

export const interLatin = localFont({
  src: "../fonts/Inter-Latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter-latin",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2190-2199, U+21BB, U+21E7, U+2212, U+2215, U+2318, U+25A0-25FF, U+2713, U+2715, U+FEFF, U+FFFD" }],
  fallback: [],
  adjustFontFallback: false,
});

export const inter = localFont({
  src: "../fonts/Inter-Extended.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-inter",
  declarations: [{ prop: "unicode-range", value: "U+0100-02FF, U+0400-04FF, U+1E00-1EFF, U+2070-209F, U+20A0-20CF, U+2100-214F, U+2190-23FF, U+2C60-2C7F, U+A720-A7FF" }],
  preload: false,
  fallback: ["Arial", "sans-serif"],
});

export const jetBrainsMonoLatin = localFont({
  src: "../fonts/JetBrainsMono-Latin.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono-latin",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2190-2199, U+21BB, U+21E7, U+2212, U+2215, U+2318, U+25A0-25FF, U+2713, U+2715, U+FEFF, U+FFFD" }],
  fallback: [],
  adjustFontFallback: false,
});

export const jetBrainsMono = localFont({
  src: "../fonts/JetBrainsMono-Extended.woff2",
  weight: "400 700",
  style: "normal",
  display: "swap",
  variable: "--font-jetbrains-mono",
  declarations: [{ prop: "unicode-range", value: "U+0100-02FF, U+0400-04FF, U+1E00-1EFF, U+2070-209F, U+20A0-20CF, U+2100-214F, U+2190-23FF, U+2C60-2C7F, U+A720-A7FF" }],
  preload: false,
  fallback: ["SFMono-Regular", "Consolas", "monospace"],
});

/** The class names that define the six variables; set on <html>. */
export const fontVariables = [
  spaceGroteskLatin.variable,
  spaceGrotesk.variable,
  interLatin.variable,
  inter.variable,
  jetBrainsMonoLatin.variable,
  jetBrainsMono.variable,
].join(" ");
