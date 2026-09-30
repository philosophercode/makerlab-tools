import { loadPendingDraft } from "../data/chat-proposals.ts";
import { loadRefreshSubject } from "../data/tool-refreshes.ts";
import { findToolForEditor } from "../data/tools.ts";
import type { ProposalSubjectKind } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { researchDisplayName, type ResearchResult } from "../research/result.ts";
import type { CurrentRecord } from "./decide.ts";
import { proposedResource } from "./decide.ts";
import type { FieldProposal } from "./types.ts";

/**
 * The record a curation turn is about (refresh research spec §12.1): a
 * catalogue tool, or a pending item's researched draft — its current values as
 * the assistant may see them, its revision, and the pages its facts came from.
 *
 * This is the one place a model is shown the record's values, on purpose: the
 * admin is steering a targeted fix, not asking for a blind check (§12.1).
 *
 * Plain Node: relative imports.
 */

export interface CurationSubject {
  kind: ProposalSubjectKind;
  id: string;
  name: string;
  revision: string;
  record: CurrentRecord;
  /** A published tool: renaming it needs `tools.publish` (§8). False for a pending item. */
  published: boolean;
  /** The URLs the record's facts came from — resource links, research's sources. */
  sources: string[];
}

export async function loadCurationSubject(
  kind: ProposalSubjectKind,
  idOrSlug: string,
  options: { db?: Db } = {}
): Promise<CurationSubject | null> {
  if (kind === "tool") {
    const found = await findToolForEditor(idOrSlug, { db: options.db });
    if (!found) return null;
    const subject = await loadRefreshSubject(found.id, { db: options.db });
    if (!subject) return null;
    return {
      kind,
      id: subject.id,
      name: subject.name,
      revision: subject.revision,
      record: subject,
      published: subject.published,
      sources: subject.resourceUrls.filter((url) => /^https?:\/\//i.test(url)),
    };
  }
  const draft = await loadPendingDraft(idOrSlug, { db: options.db });
  if (!draft || !draft.research || draft.status !== "researched") return null;
  return {
    kind,
    id: draft.id,
    // The heading names what was researched: the official name, else the item's.
    name: draft.research.canonicalName || draft.name,
    revision: draft.revision,
    record: pendingRecord(draft.research),
    published: false,
    sources: [...draft.research.sourceUrls, ...draft.research.resources.map((r) => r.url)],
  };
}

/** A pending item's research, as the fields a proposal compares with. */
export function pendingRecord(research: ResearchResult): CurrentRecord {
  return {
    name: researchDisplayName(research, research.canonicalName),
    officialName: research.canonicalName || null,
    description: research.description || null,
    materials: research.materials,
    tags: research.tags,
    trainingRequired: research.trainingRequired ?? false,
    useRestrictions: research.useRestrictions,
    emergencyStop: research.emergencyStop ?? null,
    floorCheck: null,
    resourceUrls: research.resources.map((r) => r.url),
  };
}

/** The record as `get_record` returns it and the prompt shows it: every proposal field but the cover and floor check. */
export function recordFields(record: CurrentRecord): Record<string, unknown> {
  return {
    name: record.name,
    official_name: record.officialName ?? null,
    description: record.description,
    materials: [...record.materials],
    tags: [...record.tags],
    training_required: record.trainingRequired,
    use_restrictions: record.useRestrictions,
    emergency_stop: record.emergencyStop,
    resources: [...(record.resourceUrls ?? [])],
  };
}

/**
 * A pending item's research with one accepted proposal written in — the
 * preliminary page's draft (§12.2). Null for a field a pending item has no
 * place for (the cover is chosen on the page; a floor check is for tools).
 */
export function applyToResearch(research: ResearchResult, proposal: FieldProposal): ResearchResult | null {
  const value = proposal.proposed;
  switch (proposal.field) {
    case "name":
      return typeof value === "string" ? { ...research, displayName: value } : null;
    case "official_name":
      return typeof value === "string" ? { ...research, canonicalName: value } : null;
    case "description":
      return typeof value === "string" ? { ...research, description: value } : null;
    case "materials":
      return isStringList(value) ? { ...research, materials: value } : null;
    case "tags":
      return isStringList(value) ? { ...research, tags: value } : null;
    case "training_required":
      return typeof value === "boolean" ? { ...research, trainingRequired: value } : null;
    case "use_restrictions":
      return typeof value === "string" ? { ...research, useRestrictions: value } : null;
    case "emergency_stop":
      return typeof value === "string" ? { ...research, emergencyStop: value } : null;
    case "resource": {
      const resource = proposedResource(proposal);
      if (!resource) return null;
      if (research.resources.some((r) => r.url === resource.url)) return research;
      return { ...research, resources: [...research.resources, resource] };
    }
    case "cover_photo":
    case "floor_check":
      return null;
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
