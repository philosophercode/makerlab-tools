// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import en from "../../messages/en.json";
import {
  mergeClientMessages,
  omitMessages,
  pickMessages,
  publicClientMessages,
  scopedClientMessages,
} from "./client-messages";
import type { Messages } from "./messages";

const english = en as unknown as Messages;
const SRC = path.resolve(__dirname, "..");

describe("pickMessages", () => {
  it("keeps the shape and only the named parts", () => {
    const messages: Messages = { a: { x: "1", y: { z: "2" } }, b: "3", c: { w: "4" } };
    expect(pickMessages(messages, ["a.y.z", "b", "nope.none"])).toEqual({ a: { y: { z: "2" } }, b: "3" });
  });

  it("merges two picks of one namespace", () => {
    expect(pickMessages({ a: { x: "1", y: "2", z: "3" } }, ["a.x", "a.z"])).toEqual({ a: { x: "1", z: "3" } });
  });

  it("hands back the original subtrees, so two providers share one object", () => {
    const messages: Messages = { a: { x: "1" } };
    expect(pickMessages(messages, ["a"]).a).toBe(messages.a);
  });
});

describe("what reaches the browser (performance plan, quick win 6)", () => {
  const size = (m: Messages) => JSON.stringify(m).length;

  it("leaves the admin and account namespaces off public pages", () => {
    const publicSet = publicClientMessages(english);
    expect(publicSet.account).toBeUndefined();
    expect((publicSet.admin as Messages).intake).toBeUndefined();
    expect((publicSet.admin as Messages).users).toBeUndefined();
    // en.json is ~105 KB; the public set is a fraction of it.
    expect(size(publicSet)).toBeLessThan(size(english) * 0.5);
  });

  it("never sends a string twice: a scope leaves out what the public set sent", () => {
    const admin = scopedClientMessages(english, "admin").admin as Messages;
    expect(admin.nav).toBeUndefined();
    expect((admin.inventory as Messages).editor).toBeUndefined();
    expect(admin.inventory).toBeDefined();
    expect(mergeClientMessages(publicClientMessages(english), scopedClientMessages(english, "admin")).admin).toEqual(english.admin);
  });

  it("omits without touching the source", () => {
    const messages: Messages = { a: { x: "1", y: "2" } };
    expect(omitMessages(messages, ["a.x"])).toEqual({ a: { y: "2" } });
    expect(omitMessages(messages, ["a.x", "a.y"])).toEqual({});
    expect(messages).toEqual({ a: { x: "1", y: "2" } });
  });
});

// ── Every client component's translations are sent by its layout ─────

type Scope = "public" | "admin" | "account";

/** The scope a route file renders in, by where it sits under `app/`. */
function routeScope(rel: string): Scope {
  if (/^app\/admin(\/|$)/.test(rel)) return "admin";
  if (/^app\/(account|oauth|mcp)(\/|$)/.test(rel)) return "account";
  return "public";
}

const AVAILABLE: Record<Scope, Messages> = {
  public: publicClientMessages(english),
  admin: mergeClientMessages(publicClientMessages(english), scopedClientMessages(english, "admin")),
  account: mergeClientMessages(publicClientMessages(english), scopedClientMessages(english, "account")),
};

function has(messages: Messages, dotted: string): boolean {
  let cur: unknown = messages;
  for (const key of dotted.split(".").filter(Boolean)) {
    if (typeof cur !== "object" || cur === null) return false;
    cur = (cur as Messages)[key];
  }
  return cur !== undefined;
}

/** Whether the whole subtree at `dotted` is sent, not just part of it. */
function hasWhole(messages: Messages, dotted: string): boolean {
  let full: unknown = english;
  let sent: unknown = messages;
  for (const key of dotted.split(".").filter(Boolean)) {
    full = (full as Messages)?.[key];
    sent = (sent as Messages)?.[key];
  }
  return sent !== undefined && covers(sent, full);
}

/** Every leaf of `full` is in `sent`, whatever the key order. */
function covers(sent: unknown, full: unknown): boolean {
  if (typeof full !== "object" || full === null) return sent === full;
  if (typeof sent !== "object" || sent === null) return false;
  return Object.entries(full).every(([key, value]) => covers((sent as Messages)[key], value));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC);
const TEXT = new Map(FILES.map((file) => [file, readFileSync(file, "utf8")]));

/** A module specifier as a file under `src/`, or null for a package. */
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(SRC, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (TEXT.has(candidate)) return candidate;
  }
  return null;
}

/** Static and dynamic imports alike: the lazy chat panel renders in the page that loads it. */
const IMPORTS = new Map(
  FILES.map((file) => {
    const specs = [...(TEXT.get(file) ?? "").matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
    return [file, specs.map((spec) => resolveImport(file, spec)).filter((f): f is string => Boolean(f))];
  })
);

/** Every scope a module can render in: the scopes of the route files that reach it. */
function scopesByFile(): Map<string, Set<Scope>> {
  const scopes = new Map<string, Set<Scope>>();
  const routes = FILES.filter((file) => /\/app\/(.+\/)?(page|layout|loading|error|not-found|template)\.tsx$/.test(file));
  for (const route of routes) {
    const scope = routeScope(path.relative(SRC, route));
    const stack = [route];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const set = scopes.get(file) ?? new Set<Scope>();
      set.add(scope);
      scopes.set(file, set);
      stack.push(...(IMPORTS.get(file) ?? []));
    }
  }
  return scopes;
}

const SCOPES = scopesByFile();

/**
 * Modules that run in the browser: those with the "use client" directive and
 * everything they import — a hook-using helper without the directive (say
 * `ConfidenceStrip`) runs client-side too, and reads only what was sent.
 */
const CLIENT_MODULES = (() => {
  const stack = FILES.filter((file) => /^\s*["']use client["']/.test(TEXT.get(file) ?? ""));
  const seen = new Set<string>();
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    stack.push(...(IMPORTS.get(file) ?? []));
  }
  return seen;
})();

function isClient(file: string): boolean {
  return CLIENT_MODULES.has(file) && (TEXT.get(file) ?? "").includes("useTranslations(");
}

/** Every key a file asks for: `ns.key` for a literal, `ns.*` when the key is computed. */
function requestedKeys(text: string): { key: string; whole: boolean }[] {
  const wanted: { key: string; whole: boolean }[] = [];
  const binding = /(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*(?:["']([^"']*)["'])?\s*\)/g;
  for (const match of text.matchAll(binding)) {
    const [, name, ns = ""] = match;
    const calls = new RegExp(`\\b${name}(?:\\.rich|\\.markup|\\.raw|\\.has)?\\(\\s*([^,)]*)`, "g");
    for (const call of text.matchAll(calls)) {
      const arg = call[1].trim();
      const literal = arg.match(/^["']([^"']+)["']$/);
      const template = arg.match(/^`([^`$]*)\$\{/);
      if (literal) wanted.push({ key: [ns, literal[1]].filter(Boolean).join("."), whole: false });
      else if (template) {
        const prefix = template[1].replace(/\.[^.]*$/, "").replace(/\.$/, "");
        wanted.push({ key: [ns, prefix].filter(Boolean).join("."), whole: true });
      } else if (arg) wanted.push({ key: ns, whole: true });
    }
  }
  return wanted;
}

describe("client components get the translations they use", () => {
  const files = FILES.filter(isClient);

  it("finds the client components, and the routes that render them", () => {
    expect(files.length).toBeGreaterThan(50);
    // The tool editor panel is admin code rendered on a public tool page.
    const panel = FILES.find((file) => file.endsWith("components/admin/ToolEditorPanel.tsx")) as string;
    expect([...(SCOPES.get(panel) ?? [])].sort()).toEqual(["admin", "public"]);
    // A module without the directive, imported by a client component, is checked too.
    expect(files.some((file) => file.endsWith("ConfidenceStrip.tsx"))).toBe(true);
  });

  it.each(files.map((file) => [path.relative(SRC, file), file]))("%s", (_rel, file) => {
    const wanted = requestedKeys(TEXT.get(file) ?? "").filter(({ key }) => has(english, key));
    const missing = [...(SCOPES.get(file) ?? new Set<Scope>(["public"]))].flatMap((scope) =>
      wanted
        .filter(({ key, whole }) => (whole ? !hasWhole(AVAILABLE[scope], key) : !has(AVAILABLE[scope], key)))
        .map(({ key, whole }) => `${scope}: ${whole ? `${key} (all of it)` : key}`)
    );
    expect(missing, "not sent where this renders — add to i18n/client-messages.ts").toEqual([]);
  });
});
