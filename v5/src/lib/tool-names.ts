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
 * Pure, client-safe and plain Node (the research workflow's steps and
 * `scripts/` import it): no imports at all.
 */

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
 * "1500 Watt", "16 Piece", "12 Points Per Inch". The long forms may be spaced
 * or hyphenated from the number; the short ones must be attached ("12V",
 * "20V", "3/8\"") so "Form 4 V2" or "Series 3 A" is never read as a spec.
 */
const LONG_UNITS =
  "inch(?:es)?|volts?|watts?|amps?|pieces?|pcs?|pc|gallons?|gal|points?\\s+per\\s+inch|tpi|rpm|ounces?|pounds?|millimet(?:er|re)s?|feet|foot|ft";
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
 * - Digits only (hyphens allowed) with four or more digits: `575267`,
 *   `196094-2`, `20-221`, `96289`. Three or fewer is a model name: `Speedy
 *   400`, `Form 4`.
 * - Letters and digits mixed, in a hyphen- or slash-separated segment, with
 *   three or more digits or six or more characters: `DCB107`, `P593`,
 *   `MR7F2LL`. Short model names stay: `X2D`, `MK4`, `MK4S`, `BT48`, `S5`,
 *   `X1-Carbon`, `A1`.
 */
export function looksLikePartNumber(token: string): boolean {
  const bare = token.replace(/^[^\w#]+|[^\w+]+$/g, "");
  if (!bare) return false;
  if (/^#\d+/.test(bare)) return true;
  if (/^\d[\d-]*$/.test(bare)) return countDigits(bare) >= 4;
  return bare.split(/[-/.]/).some((segment) => {
    // "DC-3401": a run of four or more digits is a code wherever it sits.
    if (/^\d{4,}$/.test(segment)) return true;
    if (!/[a-z]/i.test(segment) || !/\d/.test(segment)) return false;
    return countDigits(segment) >= 3 || segment.length >= 6;
  });
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
function stripNoise(raw: string): { text: string; problems: Set<DisplayNameProblem> } {
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
  text = withoutSpecs;

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
  return tidy(kept.join(" "));
}

/**
 * Why `name` is not a display name as it stands; empty when it is one.
 * Style is not a problem: "MAKITA Plunge Base" follows the rules.
 */
export function displayNameProblems(name: string): DisplayNameProblem[] {
  const text = squash(name);
  if (!text) return ["empty"];
  const { problems } = stripNoise(text);
  const out: DisplayNameProblem[] = [...problems];
  if (text.length > DISPLAY_NAME_MAX) out.push("too_long");
  return out;
}

/** True when `name` follows the display rules — the lab's names that must be kept. */
export function isValidDisplayName(name: string): boolean {
  return displayNameProblems(name).length === 0;
}

/**
 * The guard: `raw` with bracketed noise, spec runs and part numbers removed,
 * cut at a word boundary to {@link DISPLAY_NAME_MAX}. Only ever removes text;
 * a name that follows the rules comes back unchanged. Empty when nothing is
 * left — the caller decides the fallback.
 */
export function cleanDisplayName(raw: string | null | undefined): string {
  if (!raw) return "";
  const { text } = stripNoise(raw);
  return text.length > DISPLAY_NAME_MAX ? cutToWords(text, DISPLAY_NAME_MAX) : text;
}

/**
 * The display name research proposes: the model's own answer through the
 * guard; else the official name, else the fallback (the item's name), through
 * the guard — preferring one the guard left at least two words of, since
 * "WEN DC3401" guarded is the bare brand "WEN". A bare word is still better
 * than a part number on a card, so it comes next; the fallback cut to the cap
 * is last, so a name always results.
 */
export function displayNameFrom(candidates: {
  displayName?: string | null;
  officialName?: string | null;
  fallback: string;
}): string {
  const own = cleanDisplayName(candidates.displayName);
  if (own) return own;
  const derived = [candidates.officialName, candidates.fallback].map((name) => cleanDisplayName(name)).filter(Boolean);
  return (
    derived.find((name) => name.includes(" ")) ||
    derived[0] ||
    cutToWords(candidates.fallback, DISPLAY_NAME_MAX) ||
    squash(candidates.fallback).slice(0, DISPLAY_NAME_MAX).trim()
  );
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
