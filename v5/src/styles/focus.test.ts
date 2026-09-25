// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Keyboard focus stays visible (UI system spec §12; DESIGN.md §5): one global
 * `:focus-visible` rule draws a 2px accent-ink outline, and no stylesheet —
 * nor a component's inline `<style>` — removes an outline. Phase 6 turns this
 * into a lint rule; until then this test is the guard.
 */

const SRC = join(__dirname, "..");

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(css|tsx)$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

it("no stylesheet or inline style removes the focus outline", () => {
  const offenders = files(SRC).flatMap((file) =>
    readFileSync(file, "utf8")
      // Comments may name the rule; keep their line breaks so numbers still match.
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ""))
      .split("\n")
      .map((line, i) => ({ line, at: `${relative(SRC, file)}:${i + 1}` }))
      .filter(({ line }) => /\boutline\s*:\s*(none|0)\b/.test(line))
      .map(({ at }) => at)
  );
  expect(offenders).toEqual([]);
});

it("the global focus rule draws a 2px accent-ink outline", () => {
  const ui = readFileSync(join(__dirname, "ui.css"), "utf8");
  expect(ui).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--primary-ink\);\s*outline-offset:\s*2px;\s*\}/);
});
