// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import en from "../../../messages/en.json";

/**
 * Every card sentence is a message (assistant–GUI parity spec §6, Article 6):
 * each summary key and field a definition's `preview` names has an
 * `actions.*` string in English, so no card ever shows a raw key.
 */

const DIR = import.meta.dirname;
const sources = readdirSync(DIR)
  .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
  .map((file) => readFileSync(join(DIR, file), "utf8"))
  .join("\n");

const summaries = en.actions.summary as Record<string, string>;
const fields = en.actions.fields as Record<string, string>;
const values = en.actions.values as Record<string, Record<string, string>>;

it("has a summary string for every summary key a preview uses", () => {
  // `pending_tool` is a subject type, not a summary.
  const keys = new Set([...sources.matchAll(/"((?:people|tickets|corrections|projects|tools|units|resources|manuals|pending|imports|refresh|mirror)_[a-z_]+)"/g)].map((m) => m[1]).filter((key) => key !== "pending_tool"));
  expect(keys.size).toBeGreaterThan(8);
  expect([...keys].filter((key) => !(key in summaries))).toEqual([]);
});

it("has a label for every field a preview row names", () => {
  const used = new Set([...sources.matchAll(/field: "([a-zA-Z]+)"/g)].map((m) => m[1]));
  expect(used.size).toBeGreaterThan(5);
  expect([...used].filter((field) => !(field in fields))).toEqual([]);
});

it("has words for every vocabulary format a row can carry", () => {
  const formats = new Set([...sources.matchAll(/format: "([a-zA-Z]+)"/g)].map((m) => m[1]));
  expect([...formats].filter((format) => !(format in values))).toEqual([]);
});
