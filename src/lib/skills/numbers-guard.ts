import {
  emptyDraft,
  SKILL_BULLET_SECTIONS,
  type DraftBullet,
  type DraftTrouble,
  type RemovedItem,
  type RemovedReason,
  type SkillBulletSection,
  type SkillDraft,
} from "./format.ts";

/**
 * The checks a skill passes before it is stored (tool skills spec 2026-10-07
 * §5.2.2). The prompt asks for all of this; code makes it hold. Pure.
 *
 * 1. **Unknown source ids are stripped.** A cite the writer was not given
 *    (`M9` when there were four passages) is no citation at all.
 * 2. **The numbers guard.** An item whose text states a number — a setting, a
 *    limit, a temperature, a size, a time — with no cite left is removed
 *    (`uncited_number`). A troubleshooting row counts its symptom, check and
 *    fix together. "2D"/"3D", "step 4" and a bracketed source id are not
 *    quantities and do not count.
 * 3. **Claims that need a source.** In Before you start, Settings and limits
 *    and Safety, an item with no cite is removed (`uncited_claim`) unless it
 *    says the lab's sources do not cover it.
 * 4. **The safety floor.** An item that says protective equipment, training,
 *    a guard or a restriction is optional, not needed or skippable is removed
 *    (`weakens_safety`), cited or not: a manual's "gloves are optional" never
 *    outranks the lab, and the lab's own rules are printed by code above.
 *
 * Everything removed is returned, to be stored with the skill and shown to
 * staff. The lab's facts (`origin: "lab"`) are added after this and are never
 * checked: they are the lab's record, not the model's words.
 */

export interface GuardResult {
  /** What survived, with only known cites. */
  draft: SkillDraft;
  removed: RemovedItem[];
  /** Ids the model cited that it was never given. */
  unknownCites: string[];
}

/** Sections where every item the model writes needs a source. */
const CITE_REQUIRED: ReadonlySet<SkillBulletSection> = new Set(["beforeYouStart", "settingsAndLimits", "safety"]);

const REMOVED_TEXT_MAX = 200;

export function guardSkillDraft(draft: SkillDraft, knownIds: ReadonlySet<string>): GuardResult {
  const out = emptyDraft();
  const removed: RemovedItem[] = [];
  const unknown = new Set<string>();

  const keepCites = (cites: readonly string[]): string[] =>
    cites.filter((id) => {
      if (knownIds.has(id)) return true;
      unknown.add(id);
      return false;
    });
  const remove = (section: string, text: string, reason: RemovedReason) =>
    removed.push({ section, text: text.slice(0, REMOVED_TEXT_MAX), reason });

  for (const section of SKILL_BULLET_SECTIONS) {
    for (const item of draft[section]) {
      const cites = keepCites(item.cites);
      const reason = bulletRefusal(section, item.text, cites);
      if (reason) remove(section, item.text, reason);
      else out[section].push({ text: item.text, cites } satisfies DraftBullet);
    }
  }
  for (const row of draft.troubleshooting) {
    const cites = keepCites(row.cites);
    const all = `${row.symptom} ${row.check} ${row.fix}`;
    const reason = weakensSafety(all) ? "weakens_safety" : hasNumber(all) && cites.length === 0 ? "uncited_number" : null;
    if (reason) remove("troubleshooting", `${row.symptom} → ${row.check} → ${row.fix}`, reason);
    else out.troubleshooting.push({ ...row, cites } satisfies DraftTrouble);
  }
  // A topic the sources do not cover is a statement about the sources, not a
  // fact: it carries no number to check, and one that does is dropped.
  for (const line of draft.notInSources) {
    if (hasNumber(line)) remove("notInSources", line, "uncited_number");
    else out.notInSources.push(line);
  }
  return { draft: out, removed, unknownCites: [...unknown].sort() };
}

function bulletRefusal(section: SkillBulletSection, text: string, cites: readonly string[]): RemovedReason | null {
  if (weakensSafety(text)) return "weakens_safety";
  if (cites.length > 0) return null;
  if (hasNumber(text)) return "uncited_number";
  if (CITE_REQUIRED.has(section) && !saysNotInSources(text)) return "uncited_claim";
  return null;
}

/** Tokens with digits that are not quantities, set aside before looking for a number. */
const NOT_QUANTITIES: readonly RegExp[] = [
  // "3D printer", "2D drawing", "3-D".
  /\b[1-4]\s?-?D\b/gi,
  // "step 4", "steps 2 and 3", "steps 2–5": a reference within the guide.
  /\bsteps?\s+\d+(?:\s*(?:,|and|or|to|through|–|-)\s*\d+)*/gi,
  // A source id written in the text: "[M3]".
  /\[[TNLMRK]\d{1,3}\]/g,
];

/** True when `text` states a number once the non-quantities are set aside. */
export function hasNumber(text: string): boolean {
  let rest = text;
  for (const pattern of NOT_QUANTITIES) rest = rest.replace(pattern, " ");
  return /\d/.test(rest);
}

/** True when `text` says the sources do not cover something ("not in the lab's sources"). */
export function saysNotInSources(text: string): boolean {
  return /not in the lab['’]?s sources/i.test(text);
}

/** What a safety requirement is about: equipment, training, guards, rules. */
const SAFETY_THING =
  /\b(?:ppe|protective (?:equipment|gear|eyewear)|safety (?:glasses|goggles|gear|shoes|boots)|glasses|goggles|gloves|ear (?:protection|plugs|defenders|muffs)|hearing protection|respirator|dust mask|mask|face shield|apron|closed[- ]toe(?:d)? shoes|training|sign[- ]?off|certification|supervision|supervisor|staff present|guards?|enclosure|interlocks?|restrictions?|ventilation|fume extraction|extraction|exhaust)\b/i;

/** Words that make a safety requirement sound optional. */
const WEAKENING =
  /\boptional\b|\bunnecessary\b|\bnot (?:be )?(?:required|needed|necessary|mandatory)\b|\b(?:isn['’]t|aren['’]t|is not|are not|wasn['’]t|was not) (?:really )?(?:required|needed|necessary|mandatory)\b|\bno need\b|\b(?:don['’]t|do not|doesn['’]t|does not) (?:need|have to|require)\b|\bcan (?:be )?skip(?:ped)?\b|\bmay (?:be )?skip(?:ped)?\b/i;

/** Defeating a guard, whatever else the item says — "bypass the interlock" or "the interlock can be bypassed". */
const DEFEAT_VERB =
  "(?:skip(?:s|ped|ping)?|bypass(?:es|ed|ing)?|disabl(?:e|es|ed|ing)|defeat(?:s|ed|ing)?|overrid(?:e|es|den|ing)|tap(?:e|es|ed|ing) (?:down|over)|remov(?:e|es|ed|ing))";
const GUARD_THING = "(?:guards?|interlocks?|safety (?:switch|sensor|lid|cover)|lid sensor|door sensor|e-?stop|emergency stop)";
const DEFEAT = new RegExp(`\\b${DEFEAT_VERB}\\b.{0,40}\\b${GUARD_THING}\\b|\\b${GUARD_THING}\\b.{0,30}\\b(?:can|may|should|could) (?:be )?${DEFEAT_VERB}\\b`, "i");
/** "Never bypass", "do not remove", "must not be disabled": the opposite of defeating a guard. */
const NEGATED_DEFEAT = new RegExp(
  `\\b(?:do not|don['’]t|never|must not|mustn['’]t|should not|shouldn['’]t|cannot|can['’]t|not)\\s+(?:be\\s+)?${DEFEAT_VERB}\\b`,
  "gi"
);

/** "not optional", "never optional": the opposite of weakening. */
const AFFIRMED = /\b(?:not|never|isn['’]t|is not|are not|aren['’]t)\s+optional\b/gi;

/** True when `text` weakens a safety requirement (see the module comment). */
export function weakensSafety(text: string): boolean {
  if (DEFEAT.test(text.replace(NEGATED_DEFEAT, " "))) return true;
  if (!SAFETY_THING.test(text)) return false;
  return WEAKENING.test(text.replace(AFFIRMED, " "));
}
