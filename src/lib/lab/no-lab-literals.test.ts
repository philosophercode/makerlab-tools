// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * The guard (lab config spec 2026-10-25 §10, amendment §12.5): the lab's
 * names live in `lab/lab.config.ts` and nowhere in the app. No string the
 * code or the messages show may name Cornell, Tata, Roosevelt Island,
 * Studio 101 or "MakerLAB"; they say `lab.*`, `siteConfig.*` or a lab token
 * (`{labName}`, `{institution}`, …) instead. Comments and tests may name
 * them (they explain this deployment's history).
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const FORBIDDEN = /Cornell|Tata\b|TATA\b|Roosevelt|Studio 101|MakerLAB/;

/**
 * Messages that may name them: the original author's credit, which credits
 * the software's history, not the deploying lab (§3.3, §12.1).
 */
const MESSAGE_ALLOWLIST = new Set(["about.creditsBody", "product.credits"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

/** The text of every string, template part and JSX text in a file: what it can show, comments left out. */
function literals(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function messageValues(node: unknown, path: string[] = []): Array<{ key: string; value: string }> {
  if (typeof node === "string") return [{ key: path.join("."), value: node }];
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([key, child]) => messageValues(child, [...path, key]));
}

describe("no lab names outside the lab config", () => {
  it("src/ shows none in a string, template or JSX text", () => {
    const offenders = sourceFiles(join(ROOT, "src")).flatMap((path) =>
      literals(path)
        .filter((text) => FORBIDDEN.test(text))
        .map((text) => `${relative(ROOT, path)}: ${JSON.stringify(text.slice(0, 120))}`)
    );
    expect(offenders).toEqual([]);
  });

  it("messages/ names none outside the author's credit", () => {
    const dir = join(ROOT, "messages");
    const offenders = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .flatMap((name) =>
        messageValues(JSON.parse(readFileSync(join(dir, name), "utf8")))
          .filter(({ key, value }) => !MESSAGE_ALLOWLIST.has(key) && FORBIDDEN.test(value))
          .map(({ key, value }) => `${name} ${key}: ${JSON.stringify(value.slice(0, 120))}`)
      );
    expect(offenders).toEqual([]);
  });

  it("only the message loaders import a message file", () => {
    // Every other reader goes through them, so every string has its lab tokens filled (§12.2).
    const loaders = new Set(["src/i18n/lab-tokens.ts", "src/i18n/request.ts", "src/app/kiosk/kiosk-locale.ts"]);
    const importsMessages = /from\s+["'][./]*(?:\.\.\/)*messages\/[^"']+\.json["']|import\(\s*[`"'][^`"']*messages\//;
    const offenders = sourceFiles(join(ROOT, "src"))
      .map((path) => relative(ROOT, path))
      .filter((path) => !loaders.has(path) && importsMessages.test(readFileSync(join(ROOT, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});
