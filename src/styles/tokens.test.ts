// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The colour tokens meet WCAG 2.2 AA in both themes (UI system spec §6.1,
 * §12). The values are read from the stylesheets themselves — globals.css
 * (the palette) and ui.css (the ink, status and control tokens) — so a
 * token edited in CSS is checked here, not a copy of it.
 */

const SOURCES = ["globals.css", "ui.css"].map((f) =>
  readFileSync(join(__dirname, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
);

type Theme = "light" | "dark" | "dark-media";

/**
 * The theme's root selector exactly as the stylesheets write it: `:root` for
 * light, `:root[data-theme="dark"]` for a stored choice, and — inside the
 * `prefers-color-scheme: dark` media block — `:root:not([data-theme="light"])`.
 */
const SELECTOR: Record<Theme, string> = {
  light: ":root",
  dark: ':root[data-theme="dark"]',
  "dark-media": ':root:not([data-theme="light"])',
};

/** Custom properties declared directly on the theme's root selector. */
function tokens(theme: Theme): Record<string, string> {
  const out: Record<string, string> = {};
  const escaped = SELECTOR[theme].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = new RegExp(`(?:^|[\\s}])${escaped}\\s*\\{([^}]*)\\}`, "g");
  for (const css of SOURCES) {
    for (const [, body] of css.matchAll(block)) {
      for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
    }
  }
  return out;
}

const LIGHT = tokens("light");
const DARK = { ...LIGHT, ...tokens("dark") };

function resolve(set: Record<string, string>, name: string): string {
  let value = set[name];
  for (let i = 0; i < 5 && value?.startsWith("var("); i++) {
    value = set[value.slice(4, -1).split(",")[0].trim()];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${name} does not resolve to a hex colour (got ${value})`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(set: Record<string, string>, fg: string, bg: string): number {
  const [a, b] = [luminance(resolve(set, fg)), luminance(resolve(set, bg))].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const SURFACES = ["--background", "--surface-container", "--surface-container-low"];

// Text: 4.5:1 on every surface text sits on.
const TEXT = ["--on-surface", "--on-surface-muted", "--primary-ink", "--status-ok", "--status-warn", "--status-bad"];
// Non-text (control boundaries, focus indicator): 3:1.
const NON_TEXT = ["--outline-strong", "--primary-ink"];

/**
 * The one known exception, recorded in the spec's phase-1 amendment for the
 * owner: the approved --primary-ink (#B8431A) is 4.47:1 on the light `muted`
 * plate (#EEE8DE) — orange text belongs on the page or a card, not on
 * `muted`. Asserted separately below so it cannot get worse unnoticed.
 */
const KNOWN_EXCEPTIONS = new Set(["light --primary-ink --surface-container-low"]);

describe.each([
  ["light", LIGHT],
  ["dark", DARK],
] as const)("%s theme", (name, set) => {
  const textPairs = TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])).filter(
    ([fg, bg]) => !KNOWN_EXCEPTIONS.has(`${name} ${fg} ${bg}`)
  );

  it.each(textPairs)("text %s on %s is at least 4.5:1", (fg, bg) => {
    expect(contrast(set, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(NON_TEXT.flatMap((fg) => SURFACES.map((bg) => [fg, bg])))("boundary %s on %s is at least 3:1", (fg, bg) => {
    expect(contrast(set, fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("text on a Safety Orange fill is at least 4.5:1", () => {
    expect(contrast(set, "--ink-on-primary", "--primary")).toBeGreaterThanOrEqual(4.5);
  });
});

it("the system-preference dark block matches the explicit dark block, token for token", () => {
  // Dark mode is declared twice (the stored choice, and the OS preference when
  // nothing is stored); a token added to one and not the other is a bug.
  expect(tokens("dark-media")).toEqual(tokens("dark"));
});

it("the known exception stays where it was: --primary-ink on the light muted plate is at least 4.4:1", () => {
  expect(contrast(LIGHT, "--primary-ink", "--surface-container-low")).toBeGreaterThanOrEqual(4.4);
});

it("Safety Orange itself is not text-safe on paper — which is why --primary-ink exists", () => {
  expect(contrast(LIGHT, "--primary", "--background")).toBeLessThan(3);
});

it("crimson is a heritage stamp, not an error colour: it fails on the dark background", () => {
  expect(contrast(DARK, "--secondary", "--background")).toBeLessThan(4.5);
  expect(resolve(DARK, "--status-bad")).not.toBe(resolve(DARK, "--secondary"));
});
