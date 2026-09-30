import { attachedCiteTarget, type AttachedManualLink } from "@/lib/manuals/attached-citations";
import {
  checkCitations,
  citationLinks,
  toolPassages,
  withAttachedMentionsLinked,
  type DocumentEvidence,
  type ToolPassage,
} from "@/lib/manuals/citation-check";
import { CITE_HREF_PREFIX } from "@/lib/manuals/citation-ref";
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
 * | `cites_page` | The answer cites a manual page: a `#page=N` link or "p. N" (N = `value` when given; `file.pdf#page=N` pins the document) |
 * | `says_not_covered` | The answer says the manual does not cover the question |
 * | `citations_resolve` | Every manual link came from a `search_manual` result or a manual attached to the turn (`#cite-<ref>-<page>`, "(<title>, p. N)"), answers 200 `application/pdf`, opens a page the PDF has, and the passage is on that page (`src/lib/manuals/citation-check.ts`; the executor gathers the evidence) |
 * | `proposed_action` | That action tool was called — which only ever proposes a card (assistant–GUI parity spec §10.1) |
 * | `not_claimed_done` | The answer never says a change was made: nothing is done until the person confirms the card |
 * | `identified_tool` | The machine in a photo: the first catalog machine the answer names is `<slug>`; `<slug>\|ask` also accepts an answer that asks or says it cannot tell, naming it among the candidates; `none` means no catalog machine is claimed to be the one pictured and the answer says the lab lacks it |
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
  "not_called_tool",
  "contains_all",
  "not_contains_any",
  "no_fabricated_specs",
  "cites_resource",
  "cites_page",
  "says_not_covered",
  "citations_resolve",
  "proposed_action",
  "not_claimed_done",
  "identified_items",
  "identified_count",
  "identified_tool",
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
  /** What the tool answered, when it ran (the executor records it). */
  output?: unknown;
}

/**
 * What one manual PDF address answered, serialisable into the run's JSON
 * artifact (`DocumentEvidence` with its pages as an object). Gathered by the
 * executor (`citation-evidence.ts`) so `citations_resolve` stays pure.
 */
export interface RecordedDocumentEvidence extends Omit<DocumentEvidence, "pages"> {
  pages: Record<string, string>;
}

/** Everything an assertion is allowed to look at. */
export interface AssertionInput {
  /** The assistant's final answer text. */
  text: string;
  /** Tool calls recorded across every step of the turn. */
  toolCalls: RecordedToolCall[];
  /** Manual PDF evidence by address (no fragment), for `citations_resolve`. */
  citationEvidence?: Record<string, RecordedDocumentEvidence>;
  /**
   * The manuals attached whole to the turn, as the route streams them
   * (`data-manual-links`): what `#cite-<ref>-<page>` and "(<title>, p. N)"
   * resolve against.
   */
  attachedManuals?: AttachedManualLink[];
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
 * Lowercase, drop markdown emphasis, collapse whitespace, and straighten
 * typographic apostrophes. Lets a check match "Trotec Speedy 400" whether the
 * model wrote it plain, as `**bold**`, or as the label of a markdown link — and
 * a denial match "n't" whether the model wrote "don't" or "don’t" (U+2019),
 * which some models do by default.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
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

/** `not_called_tool` — the named tool never appears in the recorded tool calls. */
export function notCalledTool(toolCalls: RecordedToolCall[], name: string): Check {
  const count = toolCalls.filter((call) => call.name === name).length;
  if (count === 0) return { ok: true };
  return { ok: false, detail: `"${name}" was called ${count} time(s)` };
}

/**
 * Phrases that claim a change was made. A proposal is not a change (parity
 * spec §3.4): until the card is confirmed, "done" is the one thing the
 * assistant must never say.
 */
const DONE_CLAIMS = [
  /\bdone\b/,
  /\b(has|have) been (updated|changed|added|removed|resolved|set|published|logged|recorded|made)\b/,
  /\b(is|are) now (an? |the )?(admin|super admin|supermaker|resolved|published|closed|set|on the roster|added)\b/,
  /\bi('ve| have) (updated|changed|added|removed|resolved|set|published|logged|recorded|made|marked)\b/,
  /\b(successfully|all set)\b/,
];

/**
 * "done" that says where or how a change is made, not that it was: "that can
 * only be done on the People page", "removing someone is done in the app".
 * Stripped before `DONE_CLAIMS` is tried, so a refusal is not read as a claim.
 */
const DONE_NOT_A_CLAIM = [/\b(can|could|must|should|has to|have to|needs to)( only)? be done\b/g, /\bdone (only )?(on|in|from|through|via) (the|its|their|this|that)\b/g];

/** What a segment that talks about the card, not about a finished change, says. */
const PENDING_CUES = ["confirm", "card", "once you", "when you", "after you", "until", "nothing has changed", "not yet", "won't", "will not"];

/** `not_claimed_done` — no sentence says the change happened (§10.1). */
export function notClaimedDone(text: string): Check {
  for (const segment of splitSegments(text)) {
    const low = DONE_NOT_A_CLAIM.reduce((acc, phrase) => acc.replace(phrase, " "), normalize(segment));
    if (PENDING_CUES.some((cue) => low.includes(cue))) continue;
    if (DONE_CLAIMS.some((claim) => claim.test(low))) return { ok: false, detail: "the answer says the change was made", excerpt: segment };
  }
  return { ok: true };
}

/**
 * `contains_all` — every literal is present (case-insensitive, ignoring
 * markdown emphasis and curly quotes, so "People page" matches
 * "**People** page").
 */
export function containsAll(text: string, values: string[]): Check {
  const low = normalize(text);
  const missing = values.filter((value) => !low.includes(normalize(value)));
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
    case "not_called_tool": {
      const name = asString(spec.value);
      return outcome(`the assistant never called ${name}`, notCalledTool(toolCalls, name));
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
    case "cites_page": {
      const value = spec.value === undefined ? undefined : asString(spec.value);
      return outcome(
        value ? `the answer cites page ${value}` : "the answer cites a manual page",
        citesPage(expandCitationRefs(text, toolCalls, input.attachedManuals), value)
      );
    }
    case "says_not_covered":
      return outcome("the answer says the manual does not cover it", saysNotCovered(text));
    case "citations_resolve":
      return outcome(
        "every manual link came from search_manual or an attached manual, resolves to the PDF, opens a page it has, and the passage is on that page",
        citationsResolve(text, toolCalls, input.citationEvidence ?? {}, input.attachedManuals)
      );
    case "proposed_action": {
      // Every action tool only proposes (the harness stubs it to answer
      // `proposed: true`, as the real one does), so a call is a proposal.
      const name = asString(spec.value);
      return outcome(`the assistant proposed ${name}`, calledTool(toolCalls, name));
    }
    case "not_claimed_done":
      return outcome("the answer never claims the change was made", notClaimedDone(text));
    case "identified_items": {
      const wanted = asList(spec.value);
      return outcome(
        `one identify_tools call recorded ${wanted.map((w) => `"${w}"`).join(", ")}`,
        identifiedItemsMatch(toolCalls, wanted)
      );
    }
    case "identified_count": {
      const range = asString(spec.value);
      return outcome(`one identify_tools call recorded ${range} item(s)`, identifiedCount(toolCalls, range));
    }
    case "identified_tool": {
      const value = asString(spec.value);
      return outcome(identifiedToolExpectation(value), identifiedTool(text, fixture, value));
    }
  }
}

// ── identified_tool (photo identification) ─────────────────────────

/** Where the answer names a catalog machine: by a name, an alias or a `/tools/<slug>` link. */
export interface ToolMention {
  slug: string;
  index: number;
}

/**
 * The names each machine is recognised by when judging an identification: its
 * own name always, an extra alias only when no other machine's name or alias
 * contains it — "Formlabs" is dropped once the lab has a Form 2 too, since it
 * names either printer.
 */
function identifyingNames(fixture: EvalFixture): { slug: string; name: string }[] {
  const out: { slug: string; name: string }[] = [];
  for (const tool of fixture.tools) {
    for (const alias of new Set(tool.aliases)) {
      const low = normalize(alias);
      const shared =
        alias !== tool.name &&
        fixture.tools.some((other) => other.slug !== tool.slug && other.aliases.some((a) => normalize(a).includes(low)));
      if (!shared) out.push({ slug: tool.slug, name: low });
    }
  }
  return out;
}

/**
 * Every catalog machine the answer names, in order. Overlapping matches keep
 * the longest ("Ultimaker 3 Extended" is not also an "Ultimaker 3"), and a
 * markdown link counts once, at its label.
 */
export function toolMentions(text: string, fixture: EvalFixture): ToolMention[] {
  const low = normalize(text);
  const hits: { slug: string; start: number; end: number }[] = [];
  for (const { slug, name } of identifyingNames(fixture)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const match of low.matchAll(new RegExp(`(^|[^a-z0-9])(${escaped})(?=[^a-z0-9]|$)`, "g"))) {
      const start = match.index + match[1].length;
      hits.push({ slug, start, end: start + match[2].length });
    }
  }
  for (const match of low.matchAll(/\/tools\/([a-z0-9-]+)/g)) {
    if (fixture.slugs.includes(match[1])) hits.push({ slug: match[1], start: match.index, end: match.index + match[0].length });
  }
  hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: typeof hits = [];
  for (const hit of hits) {
    if (kept.some((k) => hit.start < k.end && k.start < hit.end)) continue;
    kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start).map(({ slug, start }) => ({ slug, index: start }));
}

/** "This is the …", "that looks like …", "it appears to be …" — a claim about what is pictured. */
const IDENTITY_CLAIM = /\b(this|that|it|the machine|the photo|the picture|your photo)\b[^.?!,;:]{0,30}?\b(is|'s|looks like|appears to be|seems to be|matches)\b/g;

/** The catalog machine a segment claims is pictured: one named within a few words after the claim, same clause. */
function claimedTool(segment: string, fixture: EvalFixture): string | null {
  const low = normalize(segment);
  const mentions = toolMentions(segment, fixture);
  for (const claim of low.matchAll(IDENTITY_CLAIM)) {
    const end = claim.index + claim[0].length;
    const named = mentions.find((m) => m.index >= end && m.index - end <= 25 && !/[,;:\u2014]/.test(low.slice(end, m.index)));
    if (named) return named.slug;
  }
  return null;
}

function identifiedToolExpectation(value: string): string {
  if (value === "none") return "the answer names no catalog machine as the one pictured and says the lab lacks it";
  const [slug, ask] = value.split("|");
  return ask
    ? `the answer identifies ${slug}, or asks / says it cannot tell which machine it is, with ${slug} among the candidates`
    : `the answer identifies ${slug}`;
}

/** "I can't tell which model", "which one is it", "could be either" — the answer leaves the choice open. */
const UNDECIDED =
  /\b(can't|cannot|can not|couldn't|unable to)\b[^.?!]{0,20}\b(tell|identify|determine|distinguish|confirm which)\b|\bnot (sure|clear) which\b|\bwhich (one|model)\b|\bhard to tell\b|\bcould be either\b|\balso a possibility\b|\b(doesn't|does not) (distinguish|show which)\b/;

/**
 * `identified_tool` — which catalog machine the answer says is in the photo.
 *
 *  - `<slug>`: the first catalog machine the answer names is that one. An
 *    answer that opens with the wrong machine fails even if it names the right
 *    one later; one that names no machine at all fails.
 *  - `<slug>|ask`: that, or the answer leaves the choice open — asks a
 *    question (a "?") or says it cannot tell which one it is — and names the
 *    machine among its candidates: the honest reply to an ambiguous photo.
 *    Naming a different machine first, neither asking nor hedging, fails, and
 *    so does leaving the right machine out of the candidates.
 *  - `none`: no sentence claims a catalog machine is the one pictured ("this
 *    is the Dremel 3000"), and the answer says the lab does not have it.
 *    Suggesting a catalog machine as an alternative is fine.
 */
export function identifiedTool(text: string, fixture: EvalFixture, value: string): Check {
  if (value === "none") {
    for (const segment of splitSegments(text)) {
      if (isDenial(segment)) continue;
      const claimed = claimedTool(segment, fixture);
      if (claimed) return { ok: false, detail: `the answer says the photo shows ${claimed}, a catalog machine`, excerpt: segment };
    }
    if (!splitSegments(text).some(isDenial)) {
      return { ok: false, detail: "the answer never says the lab does not have it", excerpt: text.slice(0, 200) };
    }
    return { ok: true };
  }

  const [slug, mode] = value.split("|");
  if (!fixture.slugs.includes(slug)) return { ok: false, detail: `"${slug}" is not a catalog machine in this run` };
  const mentions = toolMentions(text, fixture);
  if (mentions.length === 0) return { ok: false, detail: "the answer names no catalog machine", excerpt: text.slice(0, 200) };
  if (mentions[0].slug === slug) return { ok: true };
  const open = text.includes("?") || UNDECIDED.test(normalize(text));
  if (mode === "ask" && open && mentions.some((m) => m.slug === slug)) return { ok: true };
  return {
    ok: false,
    detail: `the answer names ${mentions[0].slug} first${mode === "ask" ? ", without asking or saying it cannot tell which machine it is" : ""}`,
    excerpt: text.slice(Math.max(0, mentions[0].index - 60), mentions[0].index + 80).trim(),
  };
}

// ── identify_tools (amendment "Many items at once") ────────────────

interface IdentifiedEntry {
  name: string;
  brand?: string;
  quantity?: number;
  attachmentIds?: string[];
}

/** The items of the last `identify_tools` call, or null when there was none. */
export function identifiedEntries(toolCalls: RecordedToolCall[]): IdentifiedEntry[] | null {
  const call = [...toolCalls].reverse().find((c) => c.name === "identify_tools");
  if (!call) return null;
  const items = (call.input as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? (items.filter((item) => item && typeof item === "object") as IdentifiedEntry[]) : [];
}

/**
 * `identified_items` — each wanted entry matches a different recorded item.
 * An entry is alternatives joined by `|`, matched case-insensitively against
 * the item's brand and name ("cricut|maker 3"), and may end in ` xN`: that item
 * must carry a quantity of at least N ("battery x2").
 */
export function identifiedItemsMatch(toolCalls: RecordedToolCall[], wanted: string[]): Check {
  const items = identifiedEntries(toolCalls);
  if (!items) return { ok: false, detail: "identify_tools was never called" };
  const used = new Set<number>();
  for (const entry of wanted) {
    const match = entry.match(/^(.*?)(?:\s+x(\d+))?$/i);
    const alternatives = (match?.[1] ?? entry).split("|").map((alt) => alt.trim().toLowerCase()).filter(Boolean);
    const quantity = match?.[2] ? Number(match[2]) : null;
    const index = items.findIndex((item, i) => {
      if (used.has(i)) return false;
      const text = `${item.brand ?? ""} ${item.name ?? ""}`.toLowerCase();
      return alternatives.some((alt) => text.includes(alt));
    });
    if (index < 0) {
      return { ok: false, detail: `no item matched "${entry}" (items: ${items.map((i) => i.name).join("; ") || "none"})` };
    }
    const found = items[index];
    if (quantity !== null && (found.quantity ?? 1) < quantity) {
      return { ok: false, detail: `"${found.name}" matched "${entry}" but has quantity ${found.quantity ?? 1}` };
    }
    used.add(index);
  }
  return { ok: true };
}

/** `identified_count` — the last identify_tools call recorded N items, or N–M. */
export function identifiedCount(toolCalls: RecordedToolCall[], range: string): Check {
  const items = identifiedEntries(toolCalls);
  if (!items) return { ok: false, detail: "identify_tools was never called" };
  const [low, high = low] = range.split("-").map(Number);
  if (items.length >= low && items.length <= high) return { ok: true };
  return { ok: false, detail: `${items.length} item(s): ${items.map((i) => i.name).join("; ")}` };
}

/**
 * A page citation (manual text spec §3.6): a link whose URL ends `#page=N`,
 * or "p. N" / "page N" in the text. With `page`, N must be that page. A
 * `page` of the form `file.pdf#page=N` pins the document too: the answer must
 * link that file at that page, so a same-numbered page of another manual on
 * the machine does not pass.
 */
export function citesPage(text: string, page?: string): Check {
  const pinned = page?.match(/^(.+)#page=(\d+)$/);
  if (pinned) {
    const [, file, n] = pinned;
    const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`${escaped}#page=${n}(?!\\d)`).test(text)) return { ok: true };
    const linked = [...text.matchAll(/([^\s/()]+\.pdf)#page=(\d+)/g)].map((m) => `${m[1]}#page=${m[2]}`);
    return {
      ok: false,
      detail: linked.length ? `links ${[...new Set(linked)].join(", ")}, not ${page}` : `no link to ${page} in the answer`,
    };
  }
  const pages = [
    ...[...text.matchAll(/#page=(\d+)/g)].map((m) => m[1]),
    ...[...text.matchAll(/\b(?:p|pp|page)\.?\s*(\d+)/gi)].map((m) => m[1]),
  ];
  if (pages.length === 0) return { ok: false, detail: "no page citation (#page=N or p. N) in the answer" };
  if (page && !pages.includes(page)) {
    return { ok: false, detail: `cites page(s) ${[...new Set(pages)].join(", ")}, not ${page}` };
  }
  return { ok: true };
}

/** The passages every recorded `search_manual` call returned. */
export function recordedPassages(toolCalls: readonly RecordedToolCall[]): ToolPassage[] {
  return toolPassages(toolCalls.filter((call) => call.name === "search_manual").map((call) => call.output));
}

/**
 * The answer with each `](#cite-<ref>)` replaced by the URL the search
 * returned for that ref — or, for an attached manual's `#cite-<ref>-<page>`
 * (or plain "(<its title>, p. N)"), its stored address at that page — what
 * the chat draws, so `cites_page`
 * judges the page the student would open. A ref nothing returned is left as
 * written.
 */
export function expandCitationRefs(
  text: string,
  toolCalls: readonly RecordedToolCall[],
  attached: readonly AttachedManualLink[] = []
): string {
  const passages = recordedPassages(toolCalls);
  if (passages.length === 0 && attached.length === 0) return text;
  return withAttachedMentionsLinked(text, attached).replace(/\]\((#cite-[^)\s]+)\)/gi, (whole, href: string) => {
    const ref = href.slice(CITE_HREF_PREFIX.length).toLowerCase();
    const url = passages.find((p) => p.ref === ref && p.url)?.url;
    if (url) return `](${url})`;
    const target = attachedCiteTarget(href, attached);
    return target ? `](${target.manual.url}#page=${target.page})` : whole;
  });
}

/**
 * `citations_resolve` (manual text spec amendments 2026-09-28 and
 * 2026-09-28b): the answer links at least one manual page — a plain-text
 * "(<attached title>, p. N)" counts, as the chat links it — and every
 * manual-looking link passes `checkCitations`: from a search result or an
 * attached manual, resolving to the PDF, a page it has, the passage on it.
 */
export function citationsResolve(
  text: string,
  toolCalls: readonly RecordedToolCall[],
  evidence: Record<string, RecordedDocumentEvidence>,
  attached: readonly AttachedManualLink[] = []
): Check {
  if (citationLinks(withAttachedMentionsLinked(text, attached)).length === 0) {
    return { ok: false, detail: "the answer links no manual page", excerpt: text.slice(0, 200) };
  }
  const byUrl = new Map<string, DocumentEvidence>(
    Object.entries(evidence).map(([url, e]) => [
      url,
      { ...e, pages: new Map(Object.entries(e.pages).map(([n, t]) => [Number(n), t])) },
    ])
  );
  const report = checkCitations(text, recordedPassages(toolCalls), byUrl, attached);
  if (report.ok) return { ok: true };
  const bad = report.citations.filter((c) => c.problems.length > 0);
  return {
    ok: false,
    detail: bad.map((c) => `${c.href}: ${c.problems.join(", ")} — ${c.detail.join("; ")}`).join("\n      "),
  };
}

/** Phrases that say the manual has no answer — the honest-absence rule for manuals. */
const NOT_COVERED_CUES = [
  "doesn't cover",
  "does not cover",
  "don't cover",
  "not covered",
  "doesn't mention",
  "does not mention",
  "doesn't say",
  "does not say",
  "doesn't include",
  "does not include",
  "doesn't specify",
  "does not specify",
  "doesn't address",
  "does not address",
  "doesn't state",
  "does not state",
  "not in the manual",
  "no information",
  "couldn't find",
  "could not find",
  "didn't find",
  "did not find",
  "isn't in",
  "is not in",
];

export function saysNotCovered(text: string): Check {
  const normal = normalize(text);
  return NOT_COVERED_CUES.some((cue) => normal.includes(cue))
    ? { ok: true }
    : { ok: false, detail: "the answer never says the manual does not cover it", excerpt: text.slice(0, 200) };
}
