import type { ToolPatch } from "../data/tools.ts";
import { normalizeLabel, normalizeText } from "./propose.ts";
import { isAcceptable, isUndecided, type FieldProposal, type ProposalDecision, type ProposedResource } from "./types.ts";

/**
 * The pure half of deciding proposals (refresh research spec §3.3, §5.2): what
 * a set of accepted proposals writes, what the record holds for a field now,
 * and how the cards move after a conflict.
 *
 * Plain Node, no database: the accept path (`apply.ts`) and the tests use it.
 */

/** The record's fields a proposal can be compared with. */
export interface CurrentRecord {
  name: string;
  description: string | null;
  materials: readonly string[];
  tags: readonly string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  emergencyStop: string | null;
  floorCheck: string | null;
  resourceUrls?: readonly string[];
  hasCover?: boolean;
}

/** What the record holds now for a proposal's field, as a card shows it. */
export function currentValue(record: CurrentRecord, proposal: FieldProposal): unknown {
  switch (proposal.field) {
    case "name":
      return record.name;
    case "description":
      return record.description;
    case "materials":
      return [...record.materials];
    case "tags":
      return [...record.tags];
    case "training_required":
      return record.trainingRequired;
    case "use_restrictions":
      return record.useRestrictions;
    case "emergency_stop":
      return record.emergencyStop;
    case "floor_check":
      return record.floorCheck;
    case "resource":
    case "cover_photo":
      return null;
  }
}

/**
 * The editor patch the accepted **field** proposals make — one save for all of
 * them, so accepting five cards is one revision check, not five. Resources and
 * the cover photo are not fields; `apply.ts` adds them through their own paths.
 */
export function patchFor(proposals: readonly FieldProposal[]): ToolPatch {
  const patch: ToolPatch = {};
  for (const p of proposals) {
    switch (p.field) {
      case "name":
        if (typeof p.proposed === "string") patch.name = p.proposed;
        break;
      case "description":
        if (typeof p.proposed === "string") patch.description = p.proposed;
        break;
      case "materials":
        if (isStringList(p.proposed)) patch.materials = p.proposed;
        break;
      case "tags":
        if (isStringList(p.proposed)) patch.tags = p.proposed;
        break;
      case "training_required":
        if (typeof p.proposed === "boolean") patch.trainingRequired = p.proposed;
        break;
      case "use_restrictions":
        if (typeof p.proposed === "string") patch.useRestrictions = p.proposed;
        break;
      case "emergency_stop":
        if (typeof p.proposed === "string") patch.emergencyStop = p.proposed;
        break;
      case "floor_check":
        if (typeof p.proposed === "string") patch.floorCheck = p.proposed;
        break;
      case "resource":
      case "cover_photo":
        break;
    }
  }
  return patch;
}

/**
 * After a conflict (§3.3): every undecided card takes the record's value now as
 * its `current`. A card whose field changed under it is marked `conflict` — the
 * admin decides it again, seeing the other person's value — and a list card's
 * proposal is re-based onto the new list, keeping only the labels still
 * missing. A card whose field did not move stays `pending`.
 */
export function rebaseAfterConflict(proposals: readonly FieldProposal[], record: CurrentRecord): FieldProposal[] {
  return proposals.map((p) => {
    if (!isUndecided(p) || p.field === "resource" || p.field === "cover_photo") return p;
    const now = currentValue(record, p);
    const moved = !sameValue(p.field, p.current, now);
    if (!moved) return p;
    if ((p.field === "materials" || p.field === "tags") && isStringList(now)) {
      const have = new Set(now.map(normalizeLabel));
      const added = (p.added ?? []).filter((label) => !have.has(normalizeLabel(label)));
      return { ...p, current: now, proposed: [...now, ...added], added, decision: "conflict" as ProposalDecision };
    }
    return { ...p, current: now, decision: "conflict" as ProposalDecision };
  });
}

/** Mark `ids` with `decision`, leaving every other card as it was. */
export function markDecided(proposals: readonly FieldProposal[], ids: ReadonlySet<string>, decision: ProposalDecision): FieldProposal[] {
  return proposals.map((p) => (ids.has(p.id) ? { ...p, decision } : p));
}

/** The ids **Accept all verified** takes: every card Accept would work on (§5.2). */
export function acceptAllVerifiedIds(proposals: readonly FieldProposal[]): string[] {
  return proposals.filter(isAcceptable).map((p) => p.id);
}

/** The ids **Reject all** takes: every undecided card. */
export function rejectAllIds(proposals: readonly FieldProposal[]): string[] {
  return proposals.filter(isUndecided).map((p) => p.id);
}

/** Nothing left for a person to decide. */
export function allDecided(proposals: readonly FieldProposal[]): boolean {
  return !proposals.some(isUndecided);
}

/** A resource proposal's link, when it is one. */
export function proposedResource(p: FieldProposal): ProposedResource | null {
  const value = p.proposed as Partial<ProposedResource> | undefined;
  if (p.field !== "resource" || !value || typeof value.url !== "string" || typeof value.title !== "string") return null;
  const type = value.type === "Manual" || value.type === "Video" ? value.type : "Other";
  return { title: value.title, url: value.url, type };
}

function sameValue(field: FieldProposal["field"], a: unknown, b: unknown): boolean {
  if (isStringList(a) && isStringList(b)) {
    const left = [...a.map(normalizeLabel)].sort().join("\n");
    const right = [...b.map(normalizeLabel)].sort().join("\n");
    return left === right;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (field === "name" || field === "description" || field === "use_restrictions" || field === "emergency_stop" || field === "floor_check") {
    return normalizeText(typeof a === "string" ? a : "") === normalizeText(typeof b === "string" ? b : "");
  }
  return a === b;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
