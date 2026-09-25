import type { CitedField } from "../research/model-output.ts";
import { researchDisplayName, type ResearchResult } from "../research/result.ts";
import { distinctDisplayName } from "../tool-name-choice.ts";
import { isValidDisplayName } from "../tool-names.ts";
import { imageIdentity } from "../web/image-url.ts";
import { addRestrictions, trainingChangeAllowed } from "./lab-rules.ts";
import { normalizeLabel, normalizeText } from "./normalize.ts";
import { SAFETY_FIELDS, type Citation, type FieldProposal, type ProposalField, type ProposalKind } from "./types.ts";

/**
 * The diff, in code (refresh research spec §3.2).
 *
 * `proposeChanges` compares a tool's record with what blind research found and
 * returns one {@link FieldProposal} per field worth a person's attention. The
 * model never decides what counts as a change — it never even saw the record.
 *
 * - **Kinds.** *new* fills an empty field; *differs* disagrees with a filled
 *   one; *unverified* is a field research left empty ("no manufacturer source
 *   found" — which is not "matches"). A value equal to the record is dropped.
 * - **Names** (tool display names spec §5.5). The **official name** is
 *   proposed (*new* or *differs*) only when research's name has a verified
 *   quote. The **display name** is proposed only when the lab's current one
 *   breaks the display rules (a part number, over the cap, bracketed noise —
 *   `displayNameProblems`) **and** research's name has a verified quote: a
 *   lab-set name that follows the rules is kept, like a lab rule, however
 *   research would have styled it. A proposed display name is never another
 *   tool's (`takenNames`): it keeps the attribute that tells the two apart,
 *   or it is not proposed (amendment 2026-09-25).
 * - **Description** is prose, so comparing it word by word is noise: it is
 *   proposed when the record's is empty (*new*) or under 120 characters
 *   (*differs*), and otherwise only when the admin asked for descriptions.
 * - **Materials and tags** are compared as sets of normalized labels. Only
 *   additions are proposed — the proposed list is the record's plus research's
 *   new labels, each listed in `added`; research never removes a label.
 * - **Training, restrictions, emergency stop** are the safety fields.
 * - **Research never replaces a lab rule** (`lab-rules.ts`, amendment
 *   2026-09-24): a restrictions proposal on a filled field keeps the lab's
 *   text and appends research's new lines (`added`); a tool that requires
 *   training is never proposed to stop requiring it.
 * - **Resources** are compared by URL, after the image finder's size-variant
 *   normalization and a leading locale segment dropped; only links the tool
 *   lacks are proposed, never a removal.
 * - **Cover photo** only when the tool has none: research's first-ranked image.
 * - **No PPE, ever**: staff set it (Isaac, 2026-09-23). There is no PPE field.
 * - **A tool research could not identify** — nothing read, or only its type
 *   known — gets one `floor_check` proposal and nothing else (§5.3).
 *
 * Pure. Plain Node: the refresh workflow's step imports it.
 */

/** What refresh compares against: the record's own fields. */
export interface ProposeTool {
  /** The display name. */
  name: string;
  /** The official name; absent on fixtures from before it. */
  officialName?: string | null;
  description: string | null;
  materials: readonly string[];
  tags: readonly string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  emergencyStop: string | null;
  floorCheck: string | null;
  resourceUrls: readonly string[];
  hasCover: boolean;
}

export interface ProposeInput {
  tool: ProposeTool;
  research: ResearchResult;
  /** Whether the admin asked for description rewrites on this run (§5.1). */
  includeDescription: boolean;
  /**
   * The other tools' display names. A `name` proposal is never one of them,
   * and a size or capacity in the current name that tells it from one of them
   * is not a rule broken (display names amendment 2026-09-25).
   */
  takenNames?: readonly string[];
}

/** A description shorter than this is proposed for replacement whatever the admin chose. */
export const SHORT_DESCRIPTION_CHARS = 120;

/** What a floor check asks staff to write down (§5.3). Stored as data, like a ticket, in English. */
export const FLOOR_CHECK_TEXT = "Record the brand, model and serial number from the machine's nameplate.";

const FIELD_ORDER: readonly ProposalField[] = [
  "use_restrictions",
  "emergency_stop",
  "training_required",
  "name",
  "official_name",
  "description",
  "materials",
  "tags",
  "resource",
  "cover_photo",
  "floor_check",
];

const KIND_ORDER: readonly ProposalKind[] = ["differs", "new", "unverified"];

export function proposeChanges(input: ProposeInput): FieldProposal[] {
  const { tool, research } = input;
  if (!isIdentified(research)) return floorCheckOnly(tool);

  const out: FieldProposal[] = [];
  const cited = (field: CitedField): Citation[] => research.citations?.[field] ?? [];

  // Names — only with a verified source (§3.2; tool display names spec §5.5).
  const official = research.canonicalName.trim();
  const nameVerified = cited("name").some((c) => c.verified);
  const currentOfficial = (tool.officialName ?? "").trim();
  if (official && nameVerified && normalizeText(official) !== normalizeText(currentOfficial)) {
    out.push(proposal("official_name", currentOfficial ? "differs" : "new", tool.officialName ?? null, official, cited("name")));
  }
  const takenNames = input.takenNames ?? [];
  if (nameVerified && !isValidDisplayName(tool.name, { takenNames })) {
    // Never another tool's name: the distinguishing attribute is kept, or no
    // proposal (display names amendment 2026-09-25).
    const display = distinctDisplayName(
      {
        base: researchDisplayName(research, tool.name, research.category?.name),
        answer: research.displayName,
        sourceName: official || tool.name,
        category: research.category?.name,
      },
      takenNames
    );
    if (display && normalizeText(display) !== normalizeText(tool.name)) {
      out.push(proposal("name", tool.name.trim() ? "differs" : "new", tool.name, display, cited("name")));
    }
  }

  // Description — opt-in unless the record's is missing or thin.
  const description = research.description.trim();
  const currentDescription = (tool.description ?? "").trim();
  if (!description) {
    out.push(unverified("description", tool.description));
  } else if (!currentDescription) {
    out.push(proposal("description", "new", tool.description, description, cited("description")));
  } else if (
    normalizeText(description) !== normalizeText(currentDescription) &&
    (currentDescription.length < SHORT_DESCRIPTION_CHARS || input.includeDescription)
  ) {
    out.push(proposal("description", "differs", tool.description, description, cited("description")));
  }

  // Materials and tags — additions only.
  for (const [field, current, found] of [
    ["materials", tool.materials, research.materials],
    ["tags", tool.tags, research.tags],
  ] as const) {
    const list = listProposal(field, current, found, cited(field));
    if (list) out.push(list);
  }

  // Training required — a boolean research may not know.
  if (research.trainingRequired === null) {
    out.push(unverified("training_required", tool.trainingRequired));
  } else if (research.trainingRequired !== tool.trainingRequired && trainingChangeAllowed(tool.trainingRequired, research.trainingRequired)) {
    out.push(proposal("training_required", "differs", tool.trainingRequired, research.trainingRequired, cited("training_required")));
  }

  // Restrictions — the lab's rule: research only adds lines beside it.
  const restrictionsFound = (research.useRestrictions ?? "").trim();
  if (!restrictionsFound) out.push(unverified("use_restrictions", tool.useRestrictions));
  else if (!(tool.useRestrictions ?? "").trim()) {
    out.push(proposal("use_restrictions", "new", tool.useRestrictions, restrictionsFound, cited("use_restrictions")));
  } else {
    const addition = addRestrictions(tool.useRestrictions, restrictionsFound);
    if (addition) {
      out.push({
        ...proposal("use_restrictions", "differs", tool.useRestrictions, addition.proposed, cited("use_restrictions")),
        added: addition.added,
      });
    }
  }

  // Emergency stop — a fact about the machine, which research may correct.
  const stopFound = (research.emergencyStop ?? "").trim();
  const stopNow = (tool.emergencyStop ?? "").trim();
  if (!stopFound) out.push(unverified("emergency_stop", tool.emergencyStop));
  else if (!stopNow) out.push(proposal("emergency_stop", "new", tool.emergencyStop, stopFound, cited("emergency_stop")));
  else if (normalizeText(stopFound) !== normalizeText(stopNow)) {
    out.push(proposal("emergency_stop", "differs", tool.emergencyStop, stopFound, cited("emergency_stop")));
  }

  // Resources — only links the tool lacks.
  const have = new Set(tool.resourceUrls.map(resourceKey).filter((key): key is string => key !== null));
  const proposedKeys = new Set<string>();
  for (const resource of research.resources) {
    const key = resourceKey(resource.url);
    if (!key || have.has(key) || proposedKeys.has(key)) continue;
    proposedKeys.add(key);
    out.push({
      id: `resource:${resource.url}`,
      field: "resource",
      kind: "new",
      safety: false,
      current: null,
      proposed: { title: resource.title, url: resource.url, type: resource.type },
      citations: [],
      decision: "pending",
    });
  }

  // Cover photo — only when there is none.
  const top = research.images?.candidates[0];
  if (!tool.hasCover && top) {
    out.push({
      id: "cover_photo",
      field: "cover_photo",
      kind: "new",
      safety: false,
      current: null,
      proposed: { url: top.url, pageUrl: top.pageUrl, width: top.width, height: top.height },
      citations: [],
      decision: "pending",
    });
  }

  return sortProposals(out);
}

/** Research identified the machine: it read something, and knew more than the kind of machine. */
export function isIdentified(research: ResearchResult): boolean {
  return research.sourceUrls.length > 0 && !research.evidence.categoryOnly;
}

function floorCheckOnly(tool: ProposeTool): FieldProposal[] {
  if ((tool.floorCheck ?? "").trim() === FLOOR_CHECK_TEXT) return [];
  return [
    {
      id: "floor_check",
      field: "floor_check",
      kind: tool.floorCheck ? "differs" : "new",
      safety: false,
      current: tool.floorCheck,
      proposed: FLOOR_CHECK_TEXT,
      citations: [],
      decision: "pending",
    },
  ];
}

function listProposal(
  field: "materials" | "tags",
  current: readonly string[],
  found: readonly string[],
  citations: Citation[]
): FieldProposal | null {
  if (found.length === 0) return unverified(field, [...current]);
  const have = new Set(current.map(normalizeLabel));
  const added: string[] = [];
  const seen = new Set<string>();
  for (const label of found) {
    const key = normalizeLabel(label);
    if (!key || have.has(key) || seen.has(key)) continue;
    seen.add(key);
    added.push(label.trim());
  }
  if (added.length === 0) return null;
  if (current.length === 0) return { ...proposal(field, "new", [], added, citations), added };
  return { ...proposal(field, "differs", [...current], [...current, ...added], citations), added };
}

function proposal(field: ProposalField, kind: ProposalKind, current: unknown, proposed: unknown, citations: Citation[]): FieldProposal {
  return { id: field, field, kind, safety: SAFETY_FIELDS.includes(field), current, proposed, citations, decision: "pending" };
}

function unverified(field: ProposalField, current: unknown): FieldProposal {
  return { id: field, field, kind: "unverified", safety: SAFETY_FIELDS.includes(field), current, citations: [], decision: "pending" };
}

/** Safety first, then differs before new before unverified, then the field order. */
export function sortProposals(proposals: readonly FieldProposal[]): FieldProposal[] {
  return [...proposals].sort(
    (a, b) =>
      Number(b.safety) - Number(a.safety) ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field)
  );
}

export { normalizeLabel, normalizeText };

/** A leading locale path segment: /en/, /en-us/, /de_DE/. */
const LOCALE_SEGMENT = /^\/[a-z]{2}(?:[-_][a-z]{2})?(?=\/|$)/i;

/**
 * The key two spellings of one resource share: the image finder's
 * size-variant normalization (`imageIdentity`: scheme, `www.`, trailing slash,
 * size parameters) and a leading locale segment dropped. Null for a non-URL.
 */
export function resourceKey(raw: string): string | null {
  try {
    const identity = imageIdentity(raw.trim());
    const slash = identity.indexOf("/");
    if (slash < 0) return identity.toLowerCase();
    const host = identity.slice(0, slash).toLowerCase();
    const rest = identity.slice(slash).replace(LOCALE_SEGMENT, "");
    return `${host}${rest}`;
  } catch {
    return null;
  }
}
