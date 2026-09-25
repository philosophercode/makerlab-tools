import { z } from "zod";

/**
 * What refresh research proposes (refresh research spec §4.2, §12.2).
 *
 * A proposal is **one field's worth of change** for a person to accept or
 * reject: the value on the record now, the value research found, what kind of
 * change it is, and the quotes it rests on. Code decides all of that
 * (`propose.ts`); a model only ever supplies a value and a quote, and a quote
 * counts only when code found it on a page that was actually read
 * (`citations.ts`).
 *
 * The same shape serves the background refresh (`tool_refreshes.proposals`)
 * and the assistant's `propose_change` (`chat_proposals.proposal`), so the
 * card, the accept path and the verification rule are written once.
 *
 * Client-safe and plain Node: the review page's islands import the types, the
 * workflow's steps the schema. Relative imports only.
 */

/** Every field a proposal can name. PPE is not one of them: lab staff set it (Isaac, 2026-09-23). */
export const PROPOSAL_FIELDS = [
  // The display name (tool display names spec 2026-09-24).
  "name",
  "official_name",
  "description",
  "materials",
  "tags",
  "training_required",
  "use_restrictions",
  "emergency_stop",
  "resource",
  "cover_photo",
  "floor_check",
] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/** The safety fields — shown first, marked on every card (§3.2). */
export const SAFETY_FIELDS: readonly ProposalField[] = ["use_restrictions", "emergency_stop", "training_required"];

/**
 * Fields whose evidence is the link or image itself rather than a quote
 * (§4.2: "except resource/cover_photo, which carry their URL"), and the floor
 * check, which is an instruction to go and look, not a claim about the web.
 */
export const QUOTE_EXEMPT_FIELDS: readonly ProposalField[] = ["resource", "cover_photo", "floor_check"];

export const PROPOSAL_KINDS = ["differs", "new", "unverified"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_DECISIONS = ["pending", "accepted", "rejected", "conflict"] as const;
export type ProposalDecision = (typeof PROPOSAL_DECISIONS)[number];

/** The longest quote kept, per §4.2. */
export const CITATION_QUOTE_MAX_CHARS = 300;

/** Quotes kept per field. */
export const CITATIONS_PER_FIELD_MAX = 3;

export interface Citation {
  /** ≤ 300 characters, verbatim from a page research read. */
  quote: string;
  url: string;
  /** Code found `quote` in that page's text (whitespace- and case-normalized). */
  verified: boolean;
}

/** A resource research found, as a proposal proposes it. */
export interface ProposedResource {
  title: string;
  url: string;
  type: "Manual" | "Video" | "Other";
}

/** The image research ranked first, as a proposal proposes it — nothing stored until accepted. */
export interface ProposedCover {
  url: string;
  pageUrl: string | null;
  width: number;
  height: number;
}

export interface FieldProposal {
  /**
   * Stable within one list: the field, or `resource:<url>` for a link — what a
   * decision names.
   */
  id: string;
  field: ProposalField;
  kind: ProposalKind;
  safety: boolean;
  /** Snapshot at proposal time (or at the last conflict), for display. */
  current: unknown;
  /** Absent for `unverified`. */
  proposed?: unknown;
  /** ≥ 1 for `differs` and `new`, except the quote-exempt fields. */
  citations: Citation[];
  decision: ProposalDecision;
  /** For a list field: the labels research adds. */
  added?: string[];
  /** A one-line reason — the assistant's (§12.1), or absent. */
  reason?: string;
}

const citationSchema = z.strictObject({
  quote: z.string().max(CITATION_QUOTE_MAX_CHARS),
  url: z.string().max(2000),
  verified: z.boolean(),
});

export const fieldProposalSchema: z.ZodType<FieldProposal> = z.strictObject({
  id: z.string().min(1).max(2100),
  field: z.enum(PROPOSAL_FIELDS),
  kind: z.enum(PROPOSAL_KINDS),
  safety: z.boolean(),
  current: z.unknown(),
  proposed: z.unknown().optional(),
  citations: z.array(citationSchema).max(CITATIONS_PER_FIELD_MAX),
  decision: z.enum(PROPOSAL_DECISIONS),
  added: z.array(z.string().max(200)).max(30).optional(),
  reason: z.string().max(200).optional(),
});

export const fieldProposalsSchema = z.array(fieldProposalSchema).max(60);

/** A stored list, or null when it does not parse (a hand-edited row). */
export function parseProposals(value: unknown): FieldProposal[] | null {
  const parsed = fieldProposalsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A proposal a person can act on: a change, not a note that research found nothing. */
export function isActionable(proposal: FieldProposal): boolean {
  return proposal.kind !== "unverified";
}

/** At least one quote code found on the page — or a field that needs none. */
export function hasVerifiedEvidence(proposal: FieldProposal): boolean {
  if (QUOTE_EXEMPT_FIELDS.includes(proposal.field)) return true;
  return proposal.citations.some((citation) => citation.verified);
}

/**
 * Whether **Accept** may be pressed on a card: a pending (or conflicted —
 * decided again, §5.2) change whose evidence was verified. An unverified quote
 * greys the card: the admin opens the editor instead (§4.2).
 */
export function isAcceptable(proposal: FieldProposal): boolean {
  return (
    isActionable(proposal) &&
    (proposal.decision === "pending" || proposal.decision === "conflict") &&
    hasVerifiedEvidence(proposal)
  );
}

/** Whether the card is still waiting for a person. */
export function isUndecided(proposal: FieldProposal): boolean {
  return isActionable(proposal) && (proposal.decision === "pending" || proposal.decision === "conflict");
}

/**
 * The review list's order (§5.2): 0 a safety *differs*, 1 a safety *new*,
 * 2 another *differs*, 3 another *new*, 4 nothing to change.
 */
export function refreshRank(proposals: readonly FieldProposal[]): number {
  const open = proposals.filter(isUndecided);
  if (open.some((p) => p.safety && p.kind === "differs")) return 0;
  if (open.some((p) => p.safety && p.kind === "new")) return 1;
  if (open.some((p) => p.kind === "differs")) return 2;
  if (open.some((p) => p.kind === "new")) return 3;
  return 4;
}

/** Counts by kind, of the proposals still waiting — what a list row shows. */
export function countByKind(proposals: readonly FieldProposal[]): { differs: number; new: number; unverified: number; safety: number } {
  const out = { differs: 0, new: 0, unverified: 0, safety: 0 };
  for (const p of proposals) {
    if (p.kind === "unverified") {
      out.unverified += 1;
      continue;
    }
    if (!isUndecided(p)) continue;
    out[p.kind] += 1;
    if (p.safety) out.safety += 1;
  }
  return out;
}
