import type { ApprovalFields, ApprovalImageChoice } from "../data/pending-tools";
import type { CategoryOption, LocationOption } from "../data/taxonomy";
import type { ResearchImages, ResearchResult } from "../research/result";
import { distinctDisplayName } from "../tool-name-choice";
import { displayNameFrom } from "../tool-names";
import { trainingAtApproval } from "./training";

/**
 * The preliminary page's starting draft, and the approval it becomes
 * (spec §5.4 step 10; moved out of `components/admin/PreliminaryToolPage.tsx`
 * so the assistant's **approve these** builds the very approval the page
 * would have sent had the reviewer pressed Approve without editing anything —
 * assistant–GUI parity spec §5.2).
 *
 * Client-safe: no directive, no server import. The page renders the draft as
 * inputs; `lib/actions/intake.ts` turns it into `ApprovalFields` on the server.
 */

/** What the draft reads from the pending item. */
export interface DraftItem {
  name: string;
  locationHint: string | null;
  serialNumber: string | null;
}


/** What the reviewer is editing: the proposal as text, the way inputs hold it. */
export interface ApprovalDraft {
  /** The display name (tool display names spec §5.3). */
  name: string;
  /** The official name; blank is none. */
  officialName: string;
  description: string;
  /** An existing category's id, or "" for none (taxonomy v2: approval never creates one). */
  category: string;
  /**
   * Also record research's proposed new category (taxonomy v2 spec §4.4) —
   * a `category_proposals` row naming the new tool, decided on
   * `/admin/taxonomy`. On by default whenever research proposed one.
   */
  proposeCategory: boolean;
  locationId: string;
  materials: string;
  ppeRequired: string;
  tags: string;
  /** Null is "staff to confirm" — saved as required unless the reviewer says otherwise (`intake/training.ts`). */
  trainingRequired: boolean | null;
  useRestrictions: string;
  serialNumber: string;
  resourceUrls: string[];
  /** The import's own links still ticked (bulk intake spec §3.4). */
  importLinkUrls: string[];
}

/** The proposal as the form's starting point. */
/** Research's display name, made distinct from every tool's when it would repeat one. */
function initialName(item: DraftItem, research: ResearchResult, takenNames: readonly string[]): string {
  const category = research.category.name || null;
  const base = displayNameFrom({
    displayName: research.displayName,
    officialName: research.canonicalName,
    fallback: item.name,
    category,
  });
  return (
    distinctDisplayName(
      { base, answer: research.displayName, sourceName: research.canonicalName.trim() || item.name, category },
      takenNames
    ) || base
  );
}

export function initialDraft(
  item: DraftItem,
  research: ResearchResult | null,
  categories: CategoryOption[],
  locations: LocationOption[],
  imported: { links: readonly { url: string }[] } | null = null,
  takenNames: readonly string[] = []
): ApprovalDraft {
  return {
    // Every link the list gave starts ticked, like research's.
    importLinkUrls: (imported?.links ?? []).map((link) => link.url),
    // Research's short name (or, on an older row, its official name through the
    // display guard); the official name beside it (tool display names spec §5.3).
    // One no other tool has, keeping the attribute that tells it apart
    // (amendment 2026-09-25); when there is none the box says so.
    name: research ? initialName(item, research, takenNames) : item.name,
    officialName: research?.canonicalName.trim() ?? "",
    description: research ? proposedDescription(research) : "",
    category: research ? proposedCategory(research, categories) : "",
    proposeCategory: research ? categoryProposalOf(research) !== null : false,
    locationId: matchLocation(item.locationHint, locations),
    materials: (research?.materials ?? []).join(", "),
    ppeRequired: (research?.ppeRequired ?? []).join(", "),
    tags: (research?.tags ?? []).join(", "),
    // Training is the lab's call (research amendment 2026-09-24): every item
    // starts at "staff to confirm", whatever research or an older row says.
    trainingRequired: null,
    useRestrictions: research?.useRestrictions ?? "",
    serialNumber: item.serialNumber ?? "",
    // Every verified link starts ticked; unticking one is the edit.
    resourceUrls: (research?.resources ?? []).map((resource) => resource.url),
  };
}

/**
 * The description research drafted, alone. The specs are no longer appended
 * as a Markdown list (gateway spec amendment 2026-09-26 "Short descriptions"):
 * a description says what the tool is and what it is for, touching on a spec
 * or two in prose. Research's specs still back its evidence and confidence.
 */
export function proposedDescription(research: ResearchResult): string {
  return research.description.trim();
}

/**
 * The category research chose, if the lab still has it (and it is not
 * retired — `categories` holds live ones only); otherwise none. Never a new
 * one: a new category is a proposal ({@link categoryProposalOf}).
 */
function proposedCategory(research: ResearchResult, categories: CategoryOption[]): string {
  const existing = research.category.existingId;
  if (existing && categories.some((category) => category.id === existing)) return existing;
  return "";
}

/**
 * The new category research proposes, as approval records it: research's own
 * `proposal` (taxonomy v2), or — for a row researched before v2, which named a
 * category the lab did not have — that name, under its group.
 */
export function categoryProposalOf(
  research: ResearchResult
): { name: string; parentSlug: string | null; description: string | null; reason: string | null } | null {
  const { proposal, existingId, slug, name, group } = research.category;
  if (proposal?.name.trim()) return proposal;
  if (!slug && existingId === null && name.trim()) return { name: name.trim(), parentSlug: group, description: null, reason: null };
  return null;
}

/** A location whose room or zone is the hint, ignoring case. */
function matchLocation(hint: string | null, locations: LocationOption[]): string {
  const wanted = hint?.trim().toLowerCase();
  if (!wanted) return "";
  const match = locations.find(
    (location) => location.room.toLowerCase() === wanted || location.zone.toLowerCase() === wanted
  );
  return match?.id ?? "";
}

/** "PLA, resin" → ["PLA", "resin"]. Blanks dropped. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The draft as `approvePendingTool` takes it, with the chosen image. */
export function toFields(draft: ApprovalDraft, research: ResearchResult, image: ApprovalImageChoice, imported = false): ApprovalFields {
  return {
    name: draft.name.trim(),
    officialName: draft.officialName.trim() || null,
    description: draft.description.trim() || null,
    categoryId: draft.category || null,
    categoryProposal: draft.proposeCategory ? categoryProposalOf(research) : null,
    locationId: draft.locationId || null,
    materials: splitList(draft.materials),
    ppeRequired: splitList(draft.ppeRequired),
    tags: splitList(draft.tags),
    trainingRequired: trainingAtApproval(draft.trainingRequired),
    useRestrictions: draft.useRestrictions.trim() || null,
    serialNumber: draft.serialNumber.trim() || null,
    resourceUrls: draft.resourceUrls,
    ...(imported ? { importLinkUrls: draft.importLinkUrls } : {}),
    image,
  };
}

const NO_IMAGE: ApprovalImageChoice = { choice: "none" };

/**
 * The image the page preselects (gateway spec §4.3), and the one the
 * assistant's **approve these** sends: the cleaned cutout when there is one,
 * otherwise rank 1, otherwise the first photo uploaded in the chat with its
 * background removed, otherwise no image. What research found leads — an
 * uploaded photo identified the item and is offered beside the found images,
 * not in their place (amendment "An uploaded photo is a choice, not the
 * product image").
 */
export function initialImageChoice(
  images: ResearchImages | null | undefined,
  uploads: readonly { attachmentId: string }[] = []
): ApprovalImageChoice {
  if (images?.cleaned) return { choice: "cleaned" };
  const first = images?.candidates[0];
  if (first) return { choice: "original", candidateUrl: first.url };
  const photo = uploads[0];
  return photo ? { choice: "upload", attachmentId: photo.attachmentId, removeBackground: true } : NO_IMAGE;
}
