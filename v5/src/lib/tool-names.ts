/**
 * A tool's two names (tool display names spec 2026-09-24).
 *
 * - **Display name** — `tools.name`: short, what people say ("Makita Plunge
 *   Base", "Formlabs Form 4", "Trotec Speedy 400"). No part numbers, about
 *   {@link DISPLAY_NAME_TARGET} characters, never more than
 *   {@link DISPLAY_NAME_MAX}.
 * - **Official name** — `tools.official_name`: the full product name with brand
 *   and model or part number, for search, manuals, research and MCP. Nullable;
 *   every reader falls back to the display name.
 *
 * This module is the one rule. {@link displayNameProblems} says why a name is
 * not a display name; {@link cleanDisplayName} is the guard every model answer
 * passes before it is stored or proposed — it only ever removes text, and
 * leaves a name that follows the rules exactly as it was.
 *
 * Whether a name says what the item is (not just a brand) is
 * `./tool-name-brand.ts`; choosing a name no other tool has is
 * `./tool-name-choice.ts` (display names amendment 2026-09-25).
 *
 * Pure, client-safe and plain Node (the research workflow's steps and
 * `scripts/` import it): its one import is its pure sibling.
 */
import { brandLabel, categoryNoun, isBareBrand } from "./tool-name-brand.ts";

/** The hard cap: a display name longer than this is refused or cut. */
export const DISPLAY_NAME_MAX = 40;

/** What a display name should aim for — the prompts say so; code enforces only the cap. */
export const DISPLAY_NAME_TARGET = 30;

/** The longest official name kept. */
export const OFFICIAL_NAME_MAX = 200;

/** Why a name is not a display name as it stands. */
export type DisplayNameProblem = "empty" | "too_long" | "part_number" | "bracket" | "spec";

/**
 * Units a number next to them makes a spec, not a name: "10-Inch", "18-Volt",
 * "1500 Watt", "16 Piece", "12 Points Per Inch", "3.0 Ah". The long forms may be spaced
 * or hyphenated from the number; the short ones must be attached ("12V",
 * "20V", "3/8\"") so "Form 4 V2" or "Series 3 A" is never read as a spec.
 */
const LONG_UNITS =
  "inch(?:es)?|volts?|watts?|amps?|m?ah|amp\\s+hours?|pieces?|pcs?|pc|gallons?|gal|points?\\s+per\\s+inch|tpi|rpm|ounces?|pounds?|millimet(?:er|re)s?|feet|foot|ft";
const SHORT_UNITS = "v|w|mm|cm|in|ah|oz|lbs?|hp|kw|\"|”|''";
const NUMBER = "\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+(?:[.,]\\d+)?)?";
const SPEC_RUN = new RegExp(
  `(?<![\\w])(?:${NUMBER}\\s*-?\\s*(?:${LONG_UNITS})\\b|${NUMBER}-?(?:${SHORT_UNITS})(?![\\w]))(?:\\s*\\/\\s*${NUMBER}-?(?:${SHORT_UNITS})(?![\\w]))*`,
  "gi"
);

/** `[…]` anywhere, including one never closed ("Shopbot Buddy BT48[L36” x W76”"). */
const BRACKETED = /\s*\[[^\]]*(?:\]|$)/g;

/** `(…)`, removed only when it holds a code or says "model"/"part" — "(Othermill Pro)" is a name. */
const PARENTHESISED = /\s*\(([^)]*)(?:\)|$)/g;

/** Words that only introduce a code: "Model 96289", "No. 12", "Part # 3". */
const CODE_INTRODUCERS = /^(?:model|mod\.?|no\.?|part|p\/n|pn|sku|item|#|ref\.?)$/i;

/** Words a cut name must not end on. */
const DANGLING = /^(?:and|&|or|for|with|of|the|a|an|to|in|by|\+|-|–|—|\/|,|\||:)$/i;

/**
 * A token that is a part or catalogue number rather than a model name.
 *
 * - `#123` — a code.
 * - Digits only with five or more digits (`575267`, `96289`), or hyphenated
 *   digits with four or more (`196094-2`, `20-221`). Four digits on their own
 *   are a model line people say — `Dremel 3000`, `Singer 7258` (display names
 *   amendment 2026-09-25) — and three or fewer always are: `Speedy 400`,
 *   `Form 4`.
 * - Letters and digits mixed, in a hyphen- or slash-separated segment, with
 *   three or more digits or six or more characters: `DCB107`, `P593`,
 *   `MR7F2LL`. Short model names stay: `X2D`, `MK4`, `MK4S`, `BT48`, `S5`,
 *   `X1-Carbon`, `A1`.
 */
export function looksLikePartNumber(token: string): boolean {
  const bare = token.replace(/^[^\w#]+|[^\w+]+$/g, "");
  if (!bare) return false;
  if (/^#\d+/.test(bare)) return true;
  if (/^\d[\d-]*$/.test(bare)) return countDigits(bare) >= (bare.includes("-") ? 4 : 5);
  return bare.split(/[-/.]/).some((segment) => {
    // "DC-3401": a run of four or more digits is a code wherever it sits.
    if (/^\d{4,}$/.test(segment)) return true;
    if (!/[a-z]/i.test(segment) || !/\d/.test(segment)) return false;
    return countDigits(segment) >= 3 || segment.length >= 6;
  });
}

/** Digit-bearing words that name a kind of machine, not a model: "3D printer", "2D cutter". */
const KIND_WORDS_WITH_DIGITS = new Set(["2d", "3d", "4d"]);

/**
 * The model tokens in a name — the words that tell one model from another:
 * every word with a digit in it, lower-cased ("Form 4" → `4`, "Ultimaker S5"
 * → `s5`, "RYOBI 18V ONE+ P103" → `p103`), once each. A spec run ("18V",
 * "10-Inch", "1500 Watt") is not a model, and neither is "3D". Used by the
 * duplicate check (research fixes amendment 2026-09-24): two names whose
 * model tokens are all different are two machines, however alike they read.
 */
export function modelTokens(name: string | null | undefined): string[] {
  const text = (name ?? "").replace(SPEC_RUN, " ").toLowerCase();
  const out = new Set<string>();
  for (const word of text.split(/[^a-z0-9]+/)) {
    if (word && /\d/.test(word) && !KIND_WORDS_WITH_DIGITS.has(word)) out.add(word);
  }
  return [...out];
}

/**
 * True when both lists name a model and no token of one matches a token of the
 * other — "Form 4" and "Form 2", "P103" and "PBP004". A token matches its
 * equal, and a bare number matches the same number run into a word ("Form4"
 * against "Form 4"). Either list empty is no conflict: nothing to compare.
 */
export function modelTokensConflict(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return !a.some((x) => b.some((y) => tokensMatch(x, y)));
}

function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return /^\d+$/.test(short) && long.endsWith(short) && /^[a-z]+$/.test(long.slice(0, -short.length));
}

function countDigits(text: string): number {
  return (text.match(/\d/g) ?? []).length;
}

/** Whitespace collapsed and trimmed — the form every comparison here uses. */
function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Everything a display name must not carry, removed — without the length cut.
 * Shared by the guard and by {@link displayNameProblems}, so "has a problem"
 * and "the guard would change it" can never disagree.
 */
function stripNoise(raw: string, keepSpecs = false): { text: string; problems: Set<DisplayNameProblem> } {
  const problems = new Set<DisplayNameProblem>();
  let text = squash(raw);

  const withoutBrackets = text.replace(BRACKETED, " ");
  if (withoutBrackets !== text) problems.add("bracket");
  text = withoutBrackets;

  text = text.replace(PARENTHESISED, (whole, inner: string) => {
    const holdsCode =
      /\b(?:model|part|sku|item|no\.)\b/i.test(inner) || inner.split(/\s+/).some(looksLikePartNumber);
    if (!holdsCode) return whole;
    problems.add("bracket");
    return " ";
  });

  const withoutSpecs = text.replace(SPEC_RUN, " ");
  if (squash(withoutSpecs) !== squash(text)) problems.add("spec");
  if (!keepSpecs) text = withoutSpecs;

  const tokens = squash(text).split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    if (looksLikePartNumber(token)) {
      problems.add("part_number");
      // "Model 96289" / "No. 12": the word that introduced the code goes with it.
      if (kept.length > 0 && CODE_INTRODUCERS.test(kept[kept.length - 1])) kept.pop();
      continue;
    }
    kept.push(token);
  }
  // A code introducer left on its own ("Model", "#") is noise too.
  while (kept.length > 0 && CODE_INTRODUCERS.test(kept[kept.length - 1])) kept.pop();

  return { text: tidy(kept.join(" ")), problems };
}

/** Separators and punctuation that removal left dangling, and empty brackets. */
function tidy(text: string): string {
  let out = squash(text)
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/([,;:/|–—-])(?:\s*[,;:/|–—-])+/g, "$1");
  out = squash(out);
  // Leading or trailing separators: ", Dust Extractor –" → "Dust Extractor".
  out = out.replace(/^[\s,;:/|–—-]+|[\s,;:/|–—-]+$/g, "");
  return squash(out);
}

/** Cut at a word boundary to at most `max`, never ending on a connector word. */
function cutToWords(text: string, max: number): string {
  const words = squash(text).split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const next = kept.length === 0 ? word : `${kept.join(" ")} ${word}`;
    if (next.length > max) break;
    kept.push(word);
  }
  while (kept.length > 0 && DANGLING.test(kept[kept.length - 1])) kept.pop();
  let out = kept.join(" ");
  // "Epilog Helix 24 laser (8000 Laser": a bracket the cut left open goes whole.
  const open = out.lastIndexOf("(");
  if (open >= 0 && out.indexOf(")", open) < 0) out = out.slice(0, open);
  return tidy(out);
}

/** What the display rules are checked against besides the name itself. */
export interface DisplayNameContext {
  /**
   * The other tools' display names. A size, capacity or power is allowed in a
   * name when it is what tells it from one of these — "Ryobi ONE+ 1.5Ah
   * Battery" beside "Ryobi ONE+ 4Ah Battery" (display names amendment
   * 2026-09-25).
   */
  takenNames?: readonly string[];
}

/**
 * Why `name` is not a display name as it stands; empty when it is one.
 * Style is not a problem: "MAKITA Plunge Base" follows the rules. A spec is
 * not one either when, without it, the name would be another tool's
 * ({@link specNeeded}).
 */
export function displayNameProblems(name: string, context: DisplayNameContext = {}): DisplayNameProblem[] {
  const text = squash(name);
  if (!text) return ["empty"];
  const { problems } = stripNoise(text);
  if (problems.has("spec") && context.takenNames && specNeeded(text, context.takenNames)) problems.delete("spec");
  const out: DisplayNameProblem[] = [...problems];
  if (text.length > DISPLAY_NAME_MAX) out.push("too_long");
  return out;
}

/** True when `name` follows the display rules — the lab's names that must be kept. */
export function isValidDisplayName(name: string, context: DisplayNameContext = {}): boolean {
  return displayNameProblems(name, context).length === 0;
}

/**
 * The guard: `raw` with bracketed noise, spec runs and part numbers removed,
 * cut at a word boundary to {@link DISPLAY_NAME_MAX}. Only ever removes text;
 * a name that follows the rules comes back unchanged. Empty when nothing is
 * left — the caller decides the fallback.
 *
 * `keepSpecs` leaves sizes, capacities and powers in: the form a caller tries
 * when the plain one is already another tool's name.
 */
export function cleanDisplayName(raw: string | null | undefined, options: { keepSpecs?: boolean } = {}): string {
  if (!raw) return "";
  const { text } = stripNoise(raw, options.keepSpecs);
  return text.length > DISPLAY_NAME_MAX ? cutToWords(text, DISPLAY_NAME_MAX) : text;
}

/** `name` with its spec runs removed and nothing else changed: "Ryobi ONE+ 4Ah Battery" → "Ryobi ONE+ Battery". */
export function withoutSpecs(name: string): string {
  return tidy(name.replace(SPEC_RUN, " "));
}

/**
 * True when some other name is this one once both lose their specs — so the
 * spec is what tells them apart and may stay.
 */
export function specNeeded(name: string, takenNames: readonly string[]): boolean {
  const key = normalizeName(withoutSpecs(name));
  if (!key) return false;
  const own = normalizeName(name);
  return takenNames.some((other) => normalizeName(other) !== own && normalizeName(withoutSpecs(other)) === key);
}

/**
 * The spec runs in a name, each written the way a card would say it:
 * "1.5 Ah" → `1.5Ah`, "3.0 Ah" → `3Ah`, "18-Volt" → `18-Volt`, "12V/20V" as one.
 */
export function specTokens(name: string): string[] {
  const out: string[] = [];
  for (const match of squash(name).matchAll(SPEC_RUN)) {
    const token = match[0]
      .replace(/(\d)[.,]0+(?!\d)/g, "$1")
      .replace(/(\d)\s*-?\s*(m?ah|v|w|mm|cm|in|oz|lbs?|hp|kw)(?![\w])/gi, (_, digit: string, unit: string) => digit + SHORT_UNIT_CASE[unit.toLowerCase()]);
    if (!out.includes(token)) out.push(token);
  }
  return out;
}

const SHORT_UNIT_CASE: Record<string, string> = {
  ah: "Ah",
  mah: "mAh",
  v: "V",
  w: "W",
  mm: "mm",
  cm: "cm",
  in: "in",
  oz: "oz",
  lb: "lb",
  lbs: "lbs",
  hp: "HP",
  kw: "kW",
};

/** Two display names that would read as one: case, spacing and punctuation ignored. */
export function isNameTaken(name: string, takenNames: readonly string[]): boolean {
  const key = normalizeName(name);
  return key !== "" && takenNames.some((other) => normalizeName(other) === key);
}

/**
 * The display name research proposes: the model's own answer through the
 * guard; else the official name, else the fallback (the item's name), through
 * the guard. A candidate that is only a brand ("Hakko", "Aoyue Int" —
 * `isBareBrand`) is passed over: the brand plus a noun from `category` comes
 * next ("Hakko Soldering Station"). A bare word is still better than a part
 * number on a card, so it follows; the fallback cut to the cap is last, so a
 * name always results.
 */
export function displayNameFrom(candidates: {
  displayName?: string | null;
  officialName?: string | null;
  fallback: string;
  /** The tool's category name ("Soldering", "Router") — the noun for a bare brand. */
  category?: string | null;
}): string {
  const source = cleanOfficialName(candidates.officialName) ?? candidates.fallback;
  const context = { sourceName: source, category: candidates.category };
  const own = cleanDisplayName(candidates.displayName);
  if (own && !isBareBrand(own, context)) return own;
  const derived = [candidates.officialName, candidates.fallback].map((name) => cleanDisplayName(name)).filter(Boolean);
  const described = derived.find((name) => !isBareBrand(name, { ...context, sourceName: source }));
  if (described) return described;
  const noun = brandWithNoun(source, candidates.category);
  if (noun) return noun;
  return (
    own ||
    derived.find((name) => name.includes(" ")) ||
    derived[0] ||
    cutToWords(candidates.fallback, DISPLAY_NAME_MAX) ||
    squash(candidates.fallback).slice(0, DISPLAY_NAME_MAX).trim()
  );
}

/**
 * The brand plus what a tool in `category` is — "Hakko Soldering Station",
 * "Makita Router" — or empty when the category names no thing or the result
 * would break the rules. The fallback for a name the guard left as a bare
 * brand.
 */
export function brandWithNoun(sourceName: string, category: string | null | undefined, brand?: string | null): string {
  const noun = categoryNoun(category);
  const label = brandLabel(sourceName, brand);
  if (!noun || !label) return "";
  const name = squash(`${label} ${noun}`);
  return isValidDisplayName(name) && !isBareBrand(name, { sourceName, brand }) ? name : "";
}

/** A name compared loosely: case, spacing and punctuation ignored. */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * The official name worth showing beside a display name: set, and not the
 * same name spelled differently. Null otherwise — the tool page shows no
 * subtitle and the prompt no "(official: …)".
 */
export function officialNameShown(tool: { name: string; officialName?: string | null }): string | null {
  const official = squash(tool.officialName ?? "");
  if (!official) return null;
  return normalizeName(official) === normalizeName(tool.name) ? null : official;
}

/** An official name as stored: trimmed, one line, ≤ {@link OFFICIAL_NAME_MAX}; null when blank. */
export function cleanOfficialName(raw: string | null | undefined): string | null {
  const text = squash(raw ?? "").slice(0, OFFICIAL_NAME_MAX).trim();
  return text || null;
}

/**
 * The best name to look a tool up by — search, manuals, research: the official
 * name when there is one, else the display name.
 */
export function lookupName(tool: { name: string; officialName?: string | null }): string {
  return cleanOfficialName(tool.officialName) ?? tool.name;
}
