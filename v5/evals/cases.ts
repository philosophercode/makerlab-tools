import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ASSERTION_KINDS,
  isAssertionKind,
  type AssertionSpec,
} from "./assertions";
import { SPEC_FIELDS } from "./fixtures";

/**
 * Case loading (design spec §4). Cases live in `evals/cases/*.yaml` as data, so
 * adding one is editing a file rather than writing code.
 *
 * The YAML here is a **deliberately small subset** — block mappings, block
 * sequences, flow sequences/maps on one line, and plain/quoted scalars. That is
 * everything the case format uses, and parsing it ourselves keeps the eval
 * harness free of a dependency the app does not otherwise need. Anything
 * outside the subset throws with a file and line number rather than being
 * quietly misread; the supported subset is documented in `evals/README.md`.
 *
 * Validation is equally loud: an unknown assertion kind or an unknown spec
 * field fails **at load**, before a single model call is made. A harness that
 * reports green because an assertion silently no-ops is worse than no harness.
 */

// ── Case types ─────────────────────────────────────────────────────

/** The surface the question is asked from. */
export interface EvalCaseContext {
  /** `gallery` (no machine focused) or `tool` (a detail page). */
  page?: "gallery" | "tool";
  /** Catalog slug of the focused machine — required when `page: tool`. */
  toolId?: string;
}

/** One eval case: a single-turn request plus the assertions it must satisfy. */
export interface EvalCase {
  id: string;
  prompt: string;
  context: EvalCaseContext;
  assert: AssertionSpec[];
  /** Case file the case came from, for error messages. */
  file: string;
}

// ── Minimal YAML ───────────────────────────────────────────────────

type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | { [key: string]: YamlValue };

interface SourceLine {
  indent: number;
  text: string;
  line: number;
}

class CaseFileError extends Error {}

/** Throw a located error. `line` 0 means "the file as a whole". */
function fail(file: string, line: number, message: string): never {
  throw new CaseFileError(line > 0 ? `${file}:${line} — ${message}` : `${file} — ${message}`);
}

/** Strip a `#` comment, ignoring `#` inside quotes. */
function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
}

function scanLines(source: string, file: string): SourceLine[] {
  const out: SourceLine[] = [];
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    const withoutComment = stripComment(raw);
    if (withoutComment.trim() === "" || withoutComment.trim() === "---") return;
    if (/^\t/.test(withoutComment)) fail(file, line, "tabs are not allowed for indentation");
    const indent = withoutComment.length - withoutComment.trimStart().length;
    out.push({ indent, text: withoutComment.trim(), line });
  });
  return out;
}

function isSeqItem(text: string): boolean {
  return text === "-" || text.startsWith("- ");
}

/** Split `key: value`, ignoring `:` inside quotes. Returns null if not a key. */
function keySplit(text: string): { key: string; rest: string } | null {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":" && (i === text.length - 1 || text[i + 1] === " ")) {
      const key = text.slice(0, i).trim();
      if (!/^[A-Za-z0-9_.-]+$/.test(key)) return null;
      return { key, rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

/** Split a flow collection body on top-level separators. */
function splitTop(body: string, file: string, line: number): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[" || char === "{") depth++;
    if (char === "]" || char === "}") depth--;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (quote) fail(file, line, "unterminated quoted string");
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

function parseScalar(text: string, file: string, line: number): YamlScalar {
  if (text.startsWith('"')) {
    if (!text.endsWith('"') || text.length < 2) fail(file, line, "unterminated double-quoted string");
    try {
      return JSON.parse(text) as string;
    } catch {
      fail(file, line, `could not parse the double-quoted string ${text}`);
    }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'") || text.length < 2) fail(file, line, "unterminated single-quoted string");
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null" || text === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === "|" || text === ">" || text.startsWith("|") || text.startsWith(">")) {
    fail(file, line, "block scalars (| and >) are not supported — use a quoted string");
  }
  if (text.includes('"') || text.includes("'")) {
    fail(file, line, `ambiguous quoting in ${text} — quote the whole value`);
  }
  return text;
}

function parseValue(text: string, file: string, line: number): YamlValue {
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) fail(file, line, "unterminated flow sequence");
    return splitTop(text.slice(1, -1), file, line).map((part) => parseValue(part, file, line));
  }
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) fail(file, line, "unterminated flow mapping");
    const map: Record<string, YamlValue> = {};
    for (const part of splitTop(text.slice(1, -1), file, line)) {
      const split = keySplit(part);
      if (!split) fail(file, line, `expected "key: value" inside { }, got ${part}`);
      map[split.key] = parseValue(split.rest, file, line);
    }
    return map;
  }
  return parseScalar(text, file, line);
}

interface Parsed {
  value: YamlValue;
  next: number;
}

function parseBlock(lines: SourceLine[], index: number, indent: number, file: string): Parsed {
  return isSeqItem(lines[index].text)
    ? parseSequence(lines, index, indent, file)
    : parseMapping(lines, index, indent, file);
}

function parseSequence(lines: SourceLine[], start: number, indent: number, file: string): Parsed {
  const items: YamlValue[] = [];
  let i = start;

  while (i < lines.length && lines[i].indent === indent && isSeqItem(lines[i].text)) {
    const line = lines[i];
    const rest = line.text.slice(1).trim();

    if (rest === "") {
      i++;
      if (i < lines.length && lines[i].indent > indent) {
        const parsed = parseBlock(lines, i, lines[i].indent, file);
        items.push(parsed.value);
        i = parsed.next;
      } else {
        items.push(null);
      }
      continue;
    }

    const inlineKey = !rest.startsWith("[") && !rest.startsWith("{") ? keySplit(rest) : null;
    if (!inlineKey) {
      items.push(parseValue(rest, file, line.line));
      i++;
      continue;
    }

    // `- key: value` starts a mapping whose remaining keys are indented under
    // the dash. Re-present the inline part as a virtual line at the child
    // indent, then parse it and the following lines as one mapping.
    const childIndent =
      i + 1 < lines.length && lines[i + 1].indent > indent ? lines[i + 1].indent : indent + 2;
    const virtual: SourceLine = { indent: childIndent, text: rest, line: line.line };
    const parsed = parseMapping([virtual, ...lines.slice(i + 1)], 0, childIndent, file);
    items.push(parsed.value);
    i += parsed.next;
  }

  return { value: items, next: i };
}

function parseMapping(lines: SourceLine[], start: number, indent: number, file: string): Parsed {
  const map: Record<string, YamlValue> = {};
  let i = start;

  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i];
    if (isSeqItem(line.text)) fail(file, line.line, "unexpected sequence item inside a mapping");

    const split = keySplit(line.text);
    if (!split) fail(file, line.line, `expected "key: value", got ${line.text}`);
    if (split.key in map) fail(file, line.line, `duplicate key "${split.key}"`);

    if (split.rest !== "") {
      map[split.key] = parseValue(split.rest, file, line.line);
      i++;
      continue;
    }

    i++;
    if (i < lines.length && lines[i].indent > indent) {
      const parsed = parseBlock(lines, i, lines[i].indent, file);
      map[split.key] = parsed.value;
      i = parsed.next;
    } else if (i < lines.length && lines[i].indent === indent && isSeqItem(lines[i].text)) {
      const parsed = parseSequence(lines, i, indent, file);
      map[split.key] = parsed.value;
      i = parsed.next;
    } else {
      map[split.key] = null;
    }
  }

  if (i < lines.length && lines[i].indent > indent) {
    fail(file, lines[i].line, "unexpected indentation");
  }
  return { value: map, next: i };
}

/** Parse the supported YAML subset. Throws with `file:line` on anything else. */
export function parseYaml(source: string, file: string): YamlValue {
  const lines = scanLines(source, file);
  if (lines.length === 0) return null;
  const parsed = parseBlock(lines, 0, lines[0].indent, file);
  if (parsed.next < lines.length) {
    fail(file, lines[parsed.next].line, "could not parse the rest of the document");
  }
  return parsed.value;
}

// ── Validation ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, YamlValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: YamlValue, file: string, what: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(file, 0, `${what} must be a non-empty string`);
  }
  return value;
}

function validateAssertion(raw: YamlValue, file: string, caseId: string): AssertionSpec {
  if (!isRecord(raw)) fail(file, 0, `case "${caseId}": each assertion must be a mapping`);

  const kind = raw.kind;
  if (!isAssertionKind(kind)) {
    fail(
      file,
      0,
      `case "${caseId}": unknown assertion kind ${JSON.stringify(kind)} — valid kinds are ${ASSERTION_KINDS.join(", ")}`
    );
  }

  const spec: AssertionSpec = { kind };

  if (raw.value !== undefined && raw.value !== null) {
    const value = raw.value;
    if (Array.isArray(value)) {
      spec.value = value.map((entry) =>
        requireString(entry, file, `case "${caseId}": ${kind} value entries`)
      );
    } else {
      spec.value = requireString(value, file, `case "${caseId}": ${kind} value`);
    }
  }

  if (raw.fields !== undefined && raw.fields !== null) {
    if (!Array.isArray(raw.fields)) {
      fail(file, 0, `case "${caseId}": ${kind} fields must be a list`);
    }
    spec.fields = raw.fields.map((field) => {
      const name = requireString(field, file, `case "${caseId}": ${kind} field names`);
      if (!(name in SPEC_FIELDS)) {
        fail(
          file,
          0,
          `case "${caseId}": unknown spec field "${name}" — known fields are ${Object.keys(SPEC_FIELDS).join(", ")}`
        );
      }
      return name;
    });
  }

  // Per-kind required arguments. An assertion missing its argument would
  // otherwise pass vacuously, which is the failure mode this harness must not
  // have.
  const needsValue: string[] = ["mentions_tool", "called_tool", "contains_all", "not_contains_any"];
  if (needsValue.includes(kind) && (spec.value === undefined || spec.value.length === 0)) {
    fail(file, 0, `case "${caseId}": ${kind} requires a "value"`);
  }
  if (kind === "no_fabricated_specs" && (!spec.fields || spec.fields.length === 0)) {
    fail(file, 0, `case "${caseId}": no_fabricated_specs requires a non-empty "fields" list`);
  }

  return spec;
}

function validateCase(raw: YamlValue, file: string): EvalCase {
  if (!isRecord(raw)) fail(file, 0, "each case must be a mapping");

  const id = requireString(raw.id, file, "case id");
  const prompt = requireString(raw.prompt, file, `case "${id}": prompt`);

  const context: EvalCaseContext = {};
  if (raw.context !== undefined && raw.context !== null) {
    if (!isRecord(raw.context)) fail(file, 0, `case "${id}": context must be a mapping`);
    for (const key of Object.keys(raw.context)) {
      if (key !== "page" && key !== "toolId") {
        fail(file, 0, `case "${id}": unknown context key "${key}" (expected page, toolId)`);
      }
    }
    if (raw.context.page !== undefined) {
      const page = raw.context.page;
      if (page !== "gallery" && page !== "tool") {
        fail(file, 0, `case "${id}": context.page must be "gallery" or "tool"`);
      }
      context.page = page;
    }
    if (raw.context.toolId !== undefined) {
      context.toolId = requireString(raw.context.toolId, file, `case "${id}": context.toolId`);
    }
    if (context.page === "tool" && !context.toolId) {
      fail(file, 0, `case "${id}": context.page "tool" requires a toolId`);
    }
  }

  if (!Array.isArray(raw.assert) || raw.assert.length === 0) {
    fail(file, 0, `case "${id}": assert must be a non-empty list`);
  }

  return {
    id,
    prompt,
    context,
    assert: raw.assert.map((entry) => validateAssertion(entry, file, id)),
    file,
  };
}

/** Parse and validate one case file. Throws on anything malformed. */
export function parseCaseFile(source: string, file: string): EvalCase[] {
  const document = parseYaml(source, file);
  if (!Array.isArray(document)) {
    fail(file, 0, "a case file must be a top-level list of cases");
  }
  if (document.length === 0) fail(file, 0, "a case file must contain at least one case");
  return document.map((entry) => validateCase(entry, file));
}

/**
 * Absolute path of the shipped `evals/cases` directory. Resolved via
 * `path.dirname` rather than `new URL("./cases", import.meta.url)` — Vite
 * rewrites that exact pattern into an asset URL, which is not a filesystem path.
 */
export const CASES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "cases");

/** Load every `*.yaml` case file in `dir`, in filename order. */
export function loadCases(dir: string = CASES_DIR): EvalCase[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort();

  const cases: EvalCase[] = [];
  const seen = new Map<string, string>();

  for (const name of files) {
    for (const evalCase of parseCaseFile(readFileSync(path.join(dir, name), "utf8"), name)) {
      const previous = seen.get(evalCase.id);
      if (previous) {
        fail(name, 0, `duplicate case id "${evalCase.id}" (already defined in ${previous})`);
      }
      seen.set(evalCase.id, name);
      cases.push(evalCase);
    }
  }

  if (cases.length === 0) fail(dir, 0, "no case files found");
  return cases;
}
