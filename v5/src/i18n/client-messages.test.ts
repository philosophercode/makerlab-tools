// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import en from "../../messages/en.json";
import {
  mergeClientMessages,
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
    expect(Object.keys(publicSet.admin as Messages).sort()).toEqual(["errors", "inventory", "mirror", "nav", "titles", "warnings"]);
    // en.json is ~109 KB; the public set is a fraction of it.
    expect(size(publicSet)).toBeLessThan(size(english) * 0.45);
  });
});

// ── Every client component's translations are sent by its layout ─────

/** Where a client component can render, by its path. */
function scopeOf(file: string): "public" | "admin" | "account" {
  const rel = path.relative(SRC, file);
  if (/(^|\/)admin\//.test(rel)) return "admin";
  if (/(^|\/)account\//.test(rel)) return "account";
  return "public";
}

const AVAILABLE = {
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

function clientFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      out.push(...clientFiles(full));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      const text = readFileSync(full, "utf8");
      if (/^\s*["']use client["']/.test(text) && text.includes("useTranslations(")) out.push(full);
    }
  }
  return out;
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
  const files = clientFiles(SRC);

  it("finds the client components", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((file) => [path.relative(SRC, file), file]))("%s", (_rel, file) => {
    const scope = scopeOf(file);
    const available = AVAILABLE[scope];
    const missing = requestedKeys(readFileSync(file, "utf8"))
      .filter(({ key, whole }) => (whole ? !hasWhole(available, key) : !has(available, key)))
      // A key that is not in en.json at all is another test's business.
      .filter(({ key }) => has(english, key))
      .map(({ key, whole }) => (whole ? `${key} (all of it)` : key));
    expect(missing, `not sent to ${scope} pages — add to i18n/client-messages.ts`).toEqual([]);
  });
});
