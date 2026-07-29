import type { EvalFixture, EvalFixtureTool } from "./fixtures";

/**
 * The assertion vocabulary (design spec §4). Deliberately small: structural,
 * deterministic checks do almost all the useful work, and every one of them is
 * a **pure function** — text and recorded tool calls in, verdict out. No I/O,
 * no model, no network, so the whole vocabulary is unit-testable inside
 * `npm test` with no API key.
 *
 * | Kind | Checks |
 * |---|---|
 * | `mentions_tool` | The named machine appears in the answer |
 * | `no_unknown_tools` | Every machine the answer offers exists in the fixture |
 * | `called_tool` | That tool appears in the recorded tool calls |
 * | `contains_all` / `not_contains_any` | Literal substrings |
 * | `no_fabricated_specs` | Numbers attributed to named fields match the fixture |
 * | `cites_resource` | The answer references one of the machine's documents |
 *
 * `no_unknown_tools` and `no_fabricated_specs` are the two that matter — they
 * are the direct test of "grounded, never fabricated," which is the whole
 * promise of the assistant.
 */

/** Every assertion kind a case file may use. Adding a kind starts here. */
export const ASSERTION_KINDS = [
  "mentions_tool",
  "no_unknown_tools",
  "called_tool",
  "contains_all",
  "not_contains_any",
  "no_fabricated_specs",
  "cites_resource",
] as const;

export type AssertionKind = (typeof ASSERTION_KINDS)[number];

/** Narrow an arbitrary value to a known assertion kind. */
export function isAssertionKind(value: unknown): value is AssertionKind {
  return typeof value === "string" && (ASSERTION_KINDS as readonly string[]).includes(value);
}

/** One assertion from a case file, after validation. */
export interface AssertionSpec {
  kind: AssertionKind;
  /** Literal(s) the assertion is about — meaning depends on `kind`. */
  value?: string | string[];
  /** Spec fields for `no_fabricated_specs`, e.g. `["build_volume"]`. */
  fields?: string[];
}

/** A tool call the assistant made during a case. */
export interface RecordedToolCall {
  name: string;
  input?: unknown;
}

/** Everything an assertion is allowed to look at. */
export interface AssertionInput {
  /** The assistant's final answer text. */
  text: string;
  /** Tool calls recorded across every step of the turn. */
  toolCalls: RecordedToolCall[];
  /** The pinned catalog. */
  fixture: EvalFixture;
  /** Slug/id of the machine the case is focused on, if any. */
  toolId?: string;
}

/** The verdict for a single assertion. */
export interface AssertionOutcome {
  kind: AssertionKind;
  ok: boolean;
  /** Human-readable statement of what was expected. */
  expected: string;
  /** Why it failed (empty when it passed). */
  detail: string;
  /** The relevant slice of the answer, when there is one. */
  excerpt?: string;
}

/** Internal result shape shared by the individual checks. */
interface Check {
  ok: boolean;
  detail?: string;
  excerpt?: string;
}

// ── Text helpers ───────────────────────────────────────────────────

/**
 * Lowercase, drop markdown emphasis, collapse whitespace. Lets a check match
 * "Trotec Speedy 400" whether the model wrote it plain, as `**bold**`, or as
 * the label of a markdown link.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split an answer into sentences and list items — the unit of judgement. */
function splitSegments(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

/**
 * Phrases that mark a segment as denying the lab has something. Without this,
 * an honest "we don't have a Glowforge" would be flagged by `no_unknown_tools`
 * as a hallucinated machine — punishing exactly the behavior we want.
 */
const NEGATION_CUES = [
  "not ",
  "n't",
  "no ",
  "none",
  "do not",
  "does not",
  "is not",
  "isn",
  "aren",
  "unfortunately",
  "instead",
  "unavailable",
  "outside",
  "elsewhere",
  "off-site",
  "campus",
  "sorry",
  "lack",
  "another lab",
  "different lab",
];

function isDenial(segment: string): boolean {
  const low = normalize(segment);
  return NEGATION_CUES.some((cue) => low.includes(cue));
}

/** Whole-word-ish containment, so "Ender" does not match "render". */
function mentionsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(normalize(text));
}

/** Every number in a string, normalized (`1,200` → `1200`). */
function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => match[0].replace(/,/g, ""));
}

/**
 * Remove catalog names, aliases and link targets before counting numbers, so
 * the "400" in "Trotec Speedy 400" is never mistaken for a fabricated spec.
 */
function stripKnownNames(text: string, fixture: EvalFixture): string {
  let out = text.replace(/\]\([^)]*\)/g, " ");
  for (const alias of [...fixture.aliases, ...fixture.slugs].sort((a, b) => b.length - a.length)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), " ");
  }
  return out;
}

/** Resolve the machines an assertion is scoped to. */
function scopedTools(fixture: EvalFixture, toolId?: string): EvalFixtureTool[] {
  if (!toolId) return fixture.tools;
  const match = fixture.tools.filter((tool) => tool.id === toolId || tool.slug === toolId);
  return match.length > 0 ? match : fixture.tools;
}

function excerptAround(text: string, needle: string): string | undefined {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return undefined;
  return text.slice(Math.max(0, index - 60), index + needle.length + 60).trim();
}

// ── The checks ─────────────────────────────────────────────────────

/** `mentions_tool` — the named machine appears somewhere in the answer. */
export function mentionsTool(text: string, name: string): Check {
  if (mentionsPhrase(text, name)) return { ok: true };
  return { ok: false, detail: `the answer never mentions "${name}"` };
}

/**
 * `no_unknown_tools` — every machine the answer *offers* exists in the fixture.
 *
 * Two independent checks:
 *  1. Every `/tools/<slug>` link target is a real catalog slug. A link to a
 *     machine page that does not exist is unambiguous fabrication.
 *  2. Every {@link EvalFixture.equipmentLexicon} name in a non-denying segment
 *     resolves to a catalog machine. "You can use the Glowforge Pro" fails;
 *     "we don't have a Glowforge, but the Trotec Speedy 400 will do it" passes.
 */
export function noUnknownTools(text: string, fixture: EvalFixture): Check {
  const problems: string[] = [];
  let excerpt: string | undefined;

  for (const match of text.matchAll(/\]\(\/tools\/([^)\s#?]+)/g)) {
    const slug = match[1];
    if (!fixture.slugs.includes(slug)) {
      problems.push(`links to /tools/${slug}, which is not a catalog machine`);
      excerpt ??= excerptAround(text, slug);
    }
  }

  const known = fixture.aliases.map(normalize);
  for (const segment of splitSegments(text)) {
    if (isDenial(segment)) continue;
    for (const token of fixture.equipmentLexicon) {
      if (!mentionsPhrase(segment, token)) continue;
      if (known.some((alias) => alias.includes(normalize(token)))) continue;
      problems.push(`presents "${token}", which is not in the catalog`);
      excerpt ??= segment;
    }
  }

  if (problems.length === 0) return { ok: true };
  return { ok: false, detail: [...new Set(problems)].join("; "), excerpt };
}

/** `called_tool` — the named tool appears in the recorded tool calls. */
export function calledTool(toolCalls: RecordedToolCall[], name: string): Check {
  if (toolCalls.some((call) => call.name === name)) return { ok: true };
  const seen = toolCalls.map((call) => call.name);
  return {
    ok: false,
    detail: `"${name}" was never called (tool calls: ${seen.length ? seen.join(", ") : "none"})`,
  };
}

/** `contains_all` — every literal is present (case-insensitive). */
export function containsAll(text: string, values: string[]): Check {
  const low = text.toLowerCase();
  const missing = values.filter((value) => !low.includes(value.toLowerCase()));
  if (missing.length === 0) return { ok: true };
  return { ok: false, detail: `missing: ${missing.map((v) => `"${v}"`).join(", ")}` };
}

/** `not_contains_any` — none of the literals is present. */
export function notContainsAny(text: string, values: string[]): Check {
  const low = text.toLowerCase();
  const found = values.filter((value) => low.includes(value.toLowerCase()));
  if (found.length === 0) return { ok: true };
  return {
    ok: false,
    detail: `found forbidden: ${found.map((v) => `"${v}"`).join(", ")}`,
    excerpt: excerptAround(text, found[0]),
  };
}

/**
 * `no_fabricated_specs` — every number the answer attributes to a named field
 * matches the fixture.
 *
 * For each field, the segments of the answer that talk about it are scanned for
 * numbers; each number must appear in the fixture's value for that field. A
 * field the catalog has no value for (build volume, laser wattage) admits **no**
 * numbers at all — which is the point: the assistant must say it does not know
 * rather than produce a plausible figure.
 */
export function noFabricatedSpecs(
  text: string,
  fields: string[],
  fixture: EvalFixture,
  toolId?: string
): Check {
  const tools = scopedTools(fixture, toolId);
  const segments = splitSegments(text);
  const problems: string[] = [];
  let excerpt: string | undefined;

  for (const field of fields) {
    const keywords = fixture.specFieldKeywords[field];
    if (!keywords) {
      problems.push(`unknown spec field "${field}"`);
      continue;
    }

    const allowed = new Set(
      tools.flatMap((tool) => numbersIn((tool.specs[field] ?? []).join(" ")))
    );

    for (const segment of segments) {
      const low = normalize(segment);
      if (!keywords.some((keyword) => low.includes(normalize(keyword)))) continue;

      for (const number of numbersIn(stripKnownNames(segment, fixture))) {
        if (allowed.has(number)) continue;
        problems.push(
          `"${number}" is attributed to ${field}, but the fixture ${
            allowed.size === 0
              ? "records no value for it"
              : `records only ${[...allowed].join(", ")}`
          }`
        );
        excerpt ??= segment;
      }
    }
  }

  if (problems.length === 0) return { ok: true };
  return { ok: false, detail: [...new Set(problems)].join("; "), excerpt };
}

/**
 * `cites_resource` — the answer references a document attached to the machine.
 * With `value`, that specific resource; without it, any resource of the focused
 * machine. Matches on the resource label or, when it has a real URL, the URL.
 */
export function citesResource(
  text: string,
  fixture: EvalFixture,
  toolId?: string,
  value?: string
): Check {
  const resources = scopedTools(fixture, toolId).flatMap((tool) => tool.resources);
  const wanted = value
    ? resources.filter((resource) => normalize(resource.label).includes(normalize(value)))
    : resources;

  if (wanted.length === 0) {
    return {
      ok: false,
      detail: value
        ? `no fixture resource matches "${value}" — the case names a document the catalog does not have`
        : "the focused machine has no resources in the fixture",
    };
  }

  const low = normalize(text);
  const hit = wanted.some(
    (resource) =>
      low.includes(normalize(resource.label)) ||
      (resource.href !== "#" && text.includes(resource.href))
  );
  if (hit) return { ok: true };

  return {
    ok: false,
    detail: `the answer cites none of: ${wanted.map((r) => `"${r.label}"`).join(", ")}`,
  };
}

// ── Dispatch ───────────────────────────────────────────────────────

/** Coerce a case-file `value` into a list of literals. */
function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Coerce a case-file `value` into a single literal. */
function asString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/**
 * Run one assertion. Every kind in {@link ASSERTION_KINDS} is handled; the
 * exhaustive switch means adding a kind without implementing it is a compile
 * error rather than a silent pass — the failure mode the design spec calls out
 * as unacceptable.
 */
export function runAssertion(spec: AssertionSpec, input: AssertionInput): AssertionOutcome {
  const { text, toolCalls, fixture, toolId } = input;

  const outcome = (expected: string, check: Check): AssertionOutcome => ({
    kind: spec.kind,
    ok: check.ok,
    expected,
    detail: check.ok ? "" : (check.detail ?? "assertion failed"),
    excerpt: check.excerpt,
  });

  switch (spec.kind) {
    case "mentions_tool": {
      const name = asString(spec.value);
      return outcome(`the answer mentions "${name}"`, mentionsTool(text, name));
    }
    case "no_unknown_tools":
      return outcome(
        "every machine the answer offers exists in the catalog",
        noUnknownTools(text, fixture)
      );
    case "called_tool": {
      const name = asString(spec.value);
      return outcome(`the assistant called ${name}`, calledTool(toolCalls, name));
    }
    case "contains_all": {
      const values = asList(spec.value);
      return outcome(
        `the answer contains ${values.map((v) => `"${v}"`).join(", ")}`,
        containsAll(text, values)
      );
    }
    case "not_contains_any": {
      const values = asList(spec.value);
      return outcome(
        `the answer contains none of ${values.map((v) => `"${v}"`).join(", ")}`,
        notContainsAny(text, values)
      );
    }
    case "no_fabricated_specs": {
      const fields = spec.fields ?? [];
      return outcome(
        `numbers attributed to ${fields.join(", ")} match the fixture`,
        noFabricatedSpecs(text, fields, fixture, toolId)
      );
    }
    case "cites_resource": {
      const value = spec.value === undefined ? undefined : asString(spec.value);
      return outcome(
        value ? `the answer cites "${value}"` : "the answer cites one of the machine's documents",
        citesResource(text, fixture, toolId, value)
      );
    }
  }
}
