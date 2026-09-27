import { normalizeText } from "./normalize.ts";
import type { FieldProposal } from "./types.ts";

/**
 * Research never replaces the lab's rules (refresh research spec, amendment
 * 2026-09-24 "Research never replaces lab rules").
 *
 * Use restrictions and whether training is required are the **lab's** rules,
 * like PPE: staff set them for their space, and a manufacturer's page is not
 * an authority over them. So for a tool in the catalogue:
 *
 * - **Restrictions are additive.** Research may add a manufacturer warning or
 *   restriction *alongside* the lab's; the proposal keeps every line the lab
 *   wrote, verbatim, and appends the new ones (`added`). It never proposes
 *   removing or rewording one.
 * - **Training only tightens.** Research may propose that training be required;
 *   it never proposes turning a lab's "training required" off.
 *
 * A pending item (intake) is different: its restrictions and training flag are
 * research's own drafts, so a proposal may replace them. PPE stays empty
 * everywhere (never a proposal field).
 *
 * The diff (`propose.ts`), the assistant's `propose_change`
 * (`capabilities/curation.ts`, chat and MCP), the conflict re-base
 * (`decide.ts`, `chat-decisions.ts`) and the accept guard (`apply.ts`'s
 * `refusalFor`) all use these functions, so the rule is written once.
 *
 * Pure. Plain Node: the refresh workflow's step imports it.
 */

/** The lines of a restrictions text: one rule per line, bullets stripped, blanks dropped. */
export function restrictionLines(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]\s+)/, "").trim())
    .filter(Boolean);
}

/**
 * The lab's restrictions with research's new lines appended — or null when
 * research adds nothing the lab's text does not already say. A found line
 * counts as already said when its normalized text appears in the lab's
 * (normalized) text.
 */
export function addRestrictions(current: string | null | undefined, found: string | null | undefined): { proposed: string; added: string[] } | null {
  const now = (current ?? "").trim();
  const have = normalizeText(now);
  const added: string[] = [];
  const seen = new Set<string>();
  for (const line of restrictionLines(found)) {
    const key = normalizeText(line);
    if (!key || seen.has(key) || (have && have.includes(key))) continue;
    seen.add(key);
    added.push(line);
  }
  if (added.length === 0) return null;
  return { proposed: now ? `${now}\n${added.join("\n")}` : added.join("\n"), added };
}

/** Whether a proposed restrictions text keeps every line of the lab's. */
export function keepsLabRestrictions(current: string | null | undefined, proposed: string): boolean {
  const next = normalizeText(proposed);
  return restrictionLines(current).every((line) => {
    const key = normalizeText(line);
    return !key || next.includes(key);
  });
}

/** Whether a change of "training required" is one research may propose: never from true to false. */
export function trainingChangeAllowed(current: boolean, proposed: boolean): boolean {
  return !(current && !proposed);
}

/**
 * Whether accepting `p` on a catalogue tool would remove or replace a lab
 * rule — the accept path's last guard, for a proposal stored before the rule
 * or re-based badly. `p.current` is the record's value the proposal was made
 * (or last re-based) against.
 */
export function replacesLabRule(p: FieldProposal): boolean {
  if (p.field === "training_required") {
    return p.current === true && p.proposed === false;
  }
  if (p.field === "use_restrictions") {
    if (typeof p.proposed !== "string") return false;
    return !keepsLabRestrictions(typeof p.current === "string" ? p.current : null, p.proposed);
  }
  return false;
}

/**
 * A restrictions proposal re-based onto the record's text now (after a
 * conflict): the lines research added, appended to what the lab has now. When
 * the lab's text already says all of them, the proposal proposes the text
 * unchanged with nothing added — the admin rejects it or leaves it.
 */
export function rebaseRestrictions(p: FieldProposal, now: string | null): FieldProposal {
  const lines = p.added && p.added.length > 0 ? p.added : restrictionLines(typeof p.proposed === "string" ? p.proposed : null);
  const addition = addRestrictions(now, lines.join("\n"));
  if (addition) return { ...p, current: now, proposed: addition.proposed, added: addition.added };
  return { ...p, current: now, proposed: now ?? "", added: [] };
}
