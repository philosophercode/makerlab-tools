/**
 * Spec coverage check — mechanical drift detection.
 *
 * Enumerates the app's *public surface* and asks, for each item, whether any
 * document under `docs/` mentions it. An item nothing mentions is undocumented:
 * either a feature that arrived without a spec, or a spec that was never updated
 * after the code moved.
 *
 * This is deliberately shallow. It cannot tell you whether the code matches what
 * a spec *says* — only whether the thing exists in the written record at all.
 * That catches the drift direction humans are worst at noticing: code growing a
 * surface nobody wrote down. Semantic conformance is the job of `/drift`.
 *
 *   npm run spec:coverage          # report
 *   npm run spec:coverage -- --ci  # exit 1 if anything is undocumented
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const APP = join(import.meta.dirname, "..");
const REPO = join(APP, "..");
const DOCS = join(REPO, "docs");

interface SurfaceItem {
  kind: "route" | "capability-tool" | "npm-script" | "env-var";
  name: string;
  source: string;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Every HTTP endpoint the app exposes. */
function findRoutes(): SurfaceItem[] {
  const apiDir = join(APP, "src/app/api");
  return walk(apiDir)
    .filter((f) => f.endsWith("route.ts"))
    .map((f) => ({
      kind: "route" as const,
      name:
        "/api/" +
        relative(join(APP, "src/app/api"), f).replace(/\/route\.ts$/, ""),
      source: relative(REPO, f),
    }));
}

/** Every tool the agent can call, on any surface. */
function findCapabilityTools(): SurfaceItem[] {
  const dir = join(APP, "src/lib/capabilities");
  const items: SurfaceItem[] = [];
  for (const f of walk(dir)) {
    if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
    const src = readFileSync(f, "utf8");
    // `name: "search_tools",` on a CapabilityTool literal
    for (const m of src.matchAll(/^\s*name:\s*"([a-z][a-z0-9_]+)"/gm)) {
      items.push({
        kind: "capability-tool",
        name: m[1],
        source: relative(REPO, f),
      });
    }
  }
  return items;
}

function findNpmScripts(): SurfaceItem[] {
  const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
  return Object.keys(pkg.scripts ?? {}).map((s) => ({
    kind: "npm-script" as const,
    name: s,
    source: "v5/package.json",
  }));
}

/** Anything the app reads from the environment. */
function findEnvVars(): SurfaceItem[] {
  const names = new Set<string>();
  for (const f of walk(join(APP, "src"))) {
    if (!f.endsWith(".ts") && !f.endsWith(".tsx")) continue;
    if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) continue;
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1]);
  }
  return [...names].sort().map((n) => ({
    kind: "env-var" as const,
    name: n,
    source: "src/**",
  }));
}

function loadDocs(): string {
  return walk(DOCS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n")
    .toLowerCase();
}

// Surface that is intentionally undocumented, with the reason. Anything added
// here is a decision, not an oversight — which is the point of it being a list.
const ACCEPTED: Record<string, string> = {
  "npm-script:dev": "standard Next.js script",
  "npm-script:build": "standard Next.js script",
  "npm-script:start": "standard Next.js script",
  "npm-script:lint": "standard tooling",
  "npm-script:typecheck": "standard tooling",
  "npm-script:test": "covered by the test-suite spec",
  "npm-script:test:watch": "covered by the test-suite spec",
  "npm-script:test:coverage": "covered by the test-suite spec",
  "npm-script:test:e2e": "covered by the test-suite spec",
  "npm-script:test:e2e:ui": "covered by the test-suite spec",
  "npm-script:test:all": "covered by the test-suite spec",
  "env-var:NODE_ENV": "runtime built-in",
  "env-var:VERCEL_URL": "platform built-in",
  "env-var:VERCEL_ENV": "platform built-in",
  "env-var:VERCEL_PROJECT_PRODUCTION_URL": "platform built-in",
  "npm-script:spec:coverage": "this script",
  "npm-script:migrate:resources": "one-off migration tool, not app surface",
  "npm-script:drop:deprecated-columns": "one-off migration tool, not app surface",
  "npm-script:clear:migration-notes": "one-off migration tool, not app surface",
};

function main() {
  const ci = process.argv.includes("--ci");
  const docs = loadDocs();
  const surface = [
    ...findRoutes(),
    ...findCapabilityTools(),
    ...findNpmScripts(),
    ...findEnvVars(),
  ];

  const undocumented = surface.filter((item) => {
    if (ACCEPTED[`${item.kind}:${item.name}`]) return false;
    return !docs.includes(item.name.toLowerCase());
  });

  const byKind = (k: SurfaceItem["kind"]) => surface.filter((s) => s.kind === k).length;
  console.log("Spec coverage — public surface vs. docs/\n");
  console.log(
    `  routes ${byKind("route")}   capability tools ${byKind("capability-tool")}   ` +
      `scripts ${byKind("npm-script")}   env vars ${byKind("env-var")}`
  );
  console.log(`  ${surface.length} total · ${undocumented.length} undocumented\n`);

  if (undocumented.length === 0) {
    console.log("  Every surface item appears in the written record.");
    return;
  }

  console.log("UNDOCUMENTED — exists in code, no document mentions it:\n");
  for (const kind of ["route", "capability-tool", "env-var", "npm-script"] as const) {
    const group = undocumented.filter((u) => u.kind === kind);
    if (!group.length) continue;
    console.log(`  ${kind}`);
    for (const u of group) console.log(`    ${u.name.padEnd(34)} ${u.source}`);
    console.log();
  }

  console.log(
    "Each of these is a decision: spec it retroactively, remove it, or add it to\n" +
      "ACCEPTED in this script with a reason. Silence is the one option that isn't.\n"
  );
  if (ci) process.exit(1);
}

main();
