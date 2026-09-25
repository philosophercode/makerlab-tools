import { brandLabel, brandWords, isBareBrand } from "./tool-name-brand.ts";
import {
  brandWithNoun,
  cleanDisplayName,
  displayNameProblems,
  DISPLAY_NAME_MAX,
  isNameTaken,
  isValidDisplayName,
  normalizeName,
  specTokens,
  withoutSpecs,
} from "./tool-names.ts";

/**
 * Choosing a display name that **says what the item is** and that **no other
 * tool has** (display names amendment 2026-09-25).
 *
 * A dry run on the real inventory named three Ryobi batteries "Ryobi ONE+
 * Battery". Display names are unique across tools, compared case- and
 * punctuation-insensitively (`normalizeName`). When shortening makes two names
 * one, each keeps the attribute that tells it apart — capacity, size, power
 * or generation — "Ryobi ONE+ 1.5Ah Battery", "Ryobi ONE+ 4Ah Battery". That
 * is the one place a spec is allowed on a card, and only because it is needed
 * (`specNeeded` in `./tool-names.ts`).
 *
 * - {@link baseDisplayName}: the model's answer through the guard, else the
 *   long name through the guard, else brand + category noun — never a bare
 *   brand. Uniqueness not yet considered.
 * - {@link distinctDisplayName}: one tool against the other tools' names —
 *   refresh proposals and the intake page's first draft.
 * - {@link resolveDisplayNames}: a batch against itself and the rest — the
 *   backfill, where the three batteries arrive together.
 *
 * Pure, client-safe and plain Node.
 */

/** What a display name is chosen from. */
export interface NameCandidate {
  /** The model's display name, as it answered; null when there is none. */
  answer?: string | null;
  /** The long name the tool is known by: its official name, else its current name. */
  sourceName: string;
  /** The tool's category name ("Soldering", "Router") — the noun for a bare brand. */
  category?: string | null;
  /** The brand, when the caller knows it. */
  brand?: string | null;
}

/**
 * The display name for one tool with uniqueness not yet considered, or ""
 * when nothing usable is left (the caller keeps the old name).
 */
export function baseDisplayName(candidate: NameCandidate): string {
  const context = { sourceName: candidate.sourceName, brand: candidate.brand, category: candidate.category };
  for (const raw of [candidate.answer, candidate.sourceName]) {
    const name = cleanDisplayName(raw);
    if (name && isValidDisplayName(name) && !isBareBrand(name, context)) return name;
  }
  return brandWithNoun(candidate.sourceName, candidate.category, candidate.brand);
}

/** Two names that read as one once their specs are gone. */
function sameWithoutSpecs(a: string, b: string): boolean {
  const key = normalizeName(withoutSpecs(a));
  return key !== "" && key === normalizeName(withoutSpecs(b));
}

/** `spec` put in front of the name's last word: "Ryobi ONE+ Battery" + `4Ah` → "Ryobi ONE+ 4Ah Battery". */
export function insertSpec(name: string, spec: string): string {
  const words = name.split(" ").filter(Boolean);
  if (words.length <= 1) return `${name} ${spec}`.trim();
  return [...words.slice(0, -1), spec, words[words.length - 1]].join(" ");
}

/** The unit a spec measures in, lower-cased: `4Ah` → "ah", `18-Volt` → "volt". */
function specUnit(spec: string): string {
  return spec.replace(/^[\d.,/\s-]+/, "").toLowerCase();
}

/** Only the spec problem — which a needed spec is allowed to have. */
function onlySpecProblem(name: string): boolean {
  return displayNameProblems(name).every((problem) => problem === "spec");
}

/**
 * A version of `base` no name in `takenNames` has, carrying the attribute
 * that tells it from `siblings` (the long or display names of the tools it
 * collides with), or "" when there is none.
 *
 * First `base` with one spec from the long name put in — the specs every
 * sibling shares ("18V") are skipped, and one measured in a unit the siblings
 * also carry ("Ah") is tried first — then the model's own answer with its
 * specs kept.
 */
export function distinguishedName(
  base: string,
  candidate: NameCandidate,
  takenNames: readonly string[],
  siblings: readonly string[]
): string {
  const context = { sourceName: candidate.sourceName, brand: candidate.brand, category: candidate.category };
  const fits = (name: string) =>
    name !== "" &&
    name.length <= DISPLAY_NAME_MAX &&
    normalizeName(name) !== normalizeName(base) &&
    onlySpecProblem(name) &&
    !isBareBrand(name, context) &&
    !isNameTaken(name, takenNames);

  const siblingSpecs = siblings.map((sibling) => specTokens(sibling).map(normalizeName));
  const siblingUnits = new Set(siblings.flatMap((sibling) => specTokens(sibling).map(specUnit)));
  // Last first: a listing names the platform ("18V") before the variant ("1.5 Ah").
  const specs = [...specTokens(candidate.sourceName)].reverse().filter(
    (spec) => siblingSpecs.length === 0 || !siblingSpecs.every((list) => list.includes(normalizeName(spec)))
  );
  specs.sort((a, b) => Number(siblingUnits.has(specUnit(b))) - Number(siblingUnits.has(specUnit(a))));
  for (const spec of specs) {
    const name = insertSpec(withoutSpecs(base), spec);
    if (fits(name)) return name;
  }
  const own = cleanDisplayName(candidate.answer, { keepSpecs: true });
  return fits(own) && sameWithoutSpecs(own, base) ? own : "";
}

/**
 * One tool's display name against the other tools' names (`takenNames`, its
 * own excluded): `base` (default {@link baseDisplayName}) when nothing else
 * reads the same, else its distinguished form, else `base` if it is at least
 * not taken outright — and "" when every form is another tool's name.
 */
export function distinctDisplayName(
  candidate: NameCandidate & { base?: string },
  takenNames: readonly string[]
): string {
  const base = candidate.base ?? baseDisplayName(candidate);
  if (!base) return "";
  const siblings = takenNames.filter((name) => sameWithoutSpecs(name, base));
  if (siblings.length === 0) return base;
  const distinct = distinguishedName(base, candidate, takenNames, siblings);
  if (distinct) return distinct;
  return isNameTaken(base, takenNames) ? "" : base;
}

/** One tool in a batch: its id, its current name, and what to choose from. */
export interface BatchCandidate extends NameCandidate {
  id: string;
  currentName: string;
}

/** A batch member's display name, or why it keeps its current one. */
export type BatchChoice = { name: string } | { name: null; reason: "no_name" | "duplicate_name" };

/**
 * Display names for a batch that are unique among themselves and against
 * `takenNames` (every tool outside the batch).
 *
 * 1. Each member's {@link baseDisplayName}.
 * 2. Members whose base reads the same as another member's, or as a name
 *    outside the batch, each get their distinguished form — **all** of them,
 *    so three batteries become 1.5Ah, 3Ah and 4Ah rather than one plain
 *    "Battery" and two with a capacity. A member that cannot be distinguished
 *    (twins; nothing in its long name to add) asks for its base.
 * 3. A last pass in order: a member whose name somebody earlier in the batch
 *    (or outside it, or a member keeping its old name) already has takes its
 *    own long name through the guard ({@link ownLongName}) when nobody has
 *    that; otherwise it is refused as `duplicate_name` and keeps its current
 *    name.
 */
export function resolveDisplayNames(
  batch: readonly BatchCandidate[],
  takenNames: readonly string[]
): Map<string, BatchChoice> {
  const bases = batch.map((candidate) => baseDisplayName(candidate));
  const chosen = batch.map((candidate, index): string | null => {
    const base = bases[index];
    if (!base) return null;
    const batchSiblings = batch.filter((_, other) => other !== index && bases[other] && sameWithoutSpecs(bases[other], base));
    const outside = takenNames.filter((name) => sameWithoutSpecs(name, base));
    if (batchSiblings.length === 0 && outside.length === 0) return base;
    const siblings = [...batchSiblings.map((sibling) => sibling.sourceName), ...outside];
    // Undistinguishable (twins, or nothing in the long name to add): the base,
    // which the last pass gives to the first member that asks for it.
    return distinguishedName(base, candidate, takenNames, siblings) || base;
  });

  const out = new Map<string, BatchChoice>();
  // Members keeping their current name still hold it.
  const assigned = [
    ...takenNames,
    ...batch.filter((_, index) => chosen[index] === null).map((candidate) => candidate.currentName),
  ];
  batch.forEach((candidate, index) => {
    const name = chosen[index];
    if (name === null) {
      out.set(candidate.id, { name: null, reason: "no_name" });
      return;
    }
    if (!isNameTaken(name, assigned)) {
      assigned.push(name);
      out.set(candidate.id, { name });
      return;
    }
    // Somebody earlier has it: this member's own long name through the guard,
    // when that says what it is and nobody has it either.
    const own = ownLongName(candidate);
    if (own && !isNameTaken(own, assigned)) {
      assigned.push(own);
      out.set(candidate.id, { name: own });
      return;
    }
    out.set(candidate.id, { name: null, reason: "duplicate_name" });
    assigned.push(candidate.currentName);
  });
  return out;
}

/**
 * The long name through the guard, its shouted brand spelled as a card would
 * ("STANLEY SharpTooth Heavy Duty Saw" → "Stanley SharpTooth Heavy Duty
 * Saw") — or "" when that breaks a rule or is only a brand.
 */
export function ownLongName(candidate: NameCandidate): string {
  const cleaned = cleanDisplayName(candidate.sourceName);
  if (!cleaned) return "";
  const brand = brandWords(candidate.sourceName, candidate.brand);
  const words = cleaned.split(" ");
  let lead = 0;
  while (lead < words.length && /^[\p{Lu}&+]+$/u.test(words[lead]) && brand.has(words[lead].toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""))) {
    lead += 1;
  }
  const name = lead > 0 ? [brandLabel(candidate.sourceName, candidate.brand), ...words.slice(lead)].join(" ") : cleaned;
  const context = { sourceName: candidate.sourceName, brand: candidate.brand, category: candidate.category };
  return isValidDisplayName(name) && !isBareBrand(name, context) ? name : "";
}
