import { z } from "zod";
import { CLEAN_NOTES, CLEANED_KINDS, imageCandidateSchema, type CleanedKind, type CleanNote, type ImageCandidate } from "../research/result.ts";

/**
 * A photo for an item named without one (data platform spec amendment "A
 * photo for a name", 2026-10-07): what `pending_tools.found_photo` holds.
 *
 * When `identify_tools` records an item from its name alone, a background run
 * (`src/workflows/found-photos.ts`) looks for **one** candidate product photo
 * with research's own image finder — one Exa search, the probe, the
 * `imageRank` model, the deterministic cutout of the winner — so the row is
 * not photo-less before research. It is a **found** picture, not anybody's
 * photo: shown "Found online" until a person approves the item, never one of
 * the item's `photos`, never a generated image.
 *
 * - `searching` — the run is under way (`requestId` names it);
 * - `found` — `candidate` is the ranked winner, `cleaned` its background-
 *   removed copy when one could be made (a private `research_image_cleaned`
 *   attachment owned by the item);
 * - `none` — nothing usable, or nothing the ranking judged the product itself;
 * - `failed` — the search or the ranking failed, `error` says why in a line.
 *
 * Plain Node: the step code and the data layer import this. What a browser is
 * shown — staleness, the route, the host — is `view.ts`'s, which stays
 * client-safe.
 */

export const FOUND_PHOTO_STATUSES = ["searching", "found", "none", "failed"] as const;
export type FoundPhotoStatus = (typeof FOUND_PHOTO_STATUSES)[number];

/** The longest `error` stored. */
export const FOUND_PHOTO_ERROR_MAX_CHARS = 200;

export interface FoundPhoto {
  requestId: string;
  /** ISO time the lookup was asked for — what staleness is measured from. */
  requestedAt: string;
  status: FoundPhotoStatus;
  candidate: ImageCandidate | null;
  cleaned: { attachmentId: string; fromUrl: string; kind?: CleanedKind } | null;
  cleanNote?: CleanNote | null;
  error: string | null;
}

export const foundPhotoSchema: z.ZodType<FoundPhoto> = z.strictObject({
  requestId: z.string().min(1),
  requestedAt: z.string().min(1),
  status: z.enum(FOUND_PHOTO_STATUSES),
  candidate: imageCandidateSchema.nullable(),
  cleaned: z
    .strictObject({ attachmentId: z.string().min(1), fromUrl: z.string().min(1), kind: z.enum(CLEANED_KINDS).optional() })
    .nullable(),
  cleanNote: z.enum(CLEAN_NOTES).nullable().optional(),
  error: z.string().max(FOUND_PHOTO_ERROR_MAX_CHARS).nullable(),
});

/** Stored JSON as a `FoundPhoto`, or null when absent or no longer the right shape. */
export function parseFoundPhoto(value: unknown): FoundPhoto | null {
  if (value == null) return null;
  const parsed = foundPhotoSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** What {@link foundPhotoEligible} reads of a pending item. */
export interface FoundPhotoSubject {
  id: string;
  status: string;
  photos: readonly unknown[];
  identifyConfidence: string | null;
  duplicateOf: unknown | null;
  duplicateResolution: string | null;
  importId: string | null;
  foundPhoto: FoundPhoto | null;
}

/**
 * The items of a fresh batch that get a photo looked up, in order: identified
 * from the chat with **no photo** of their own, not `unsure` (a plain
 * description — "Cordless drill, brand not visible" — would find some other
 * drill), not a duplicate still to decide (an existing tool has its own photo),
 * and with no lookup yet. The cap is the caller's.
 */
export function foundPhotoEligible(items: readonly FoundPhotoSubject[]): string[] {
  return items
    .filter(
      (item) =>
        item.status === "identified" &&
        item.importId === null &&
        item.photos.length === 0 &&
        item.identifyConfidence !== "unsure" &&
        (item.duplicateOf === null || item.duplicateResolution === "new_tool") &&
        item.foundPhoto === null
    )
    .map((item) => item.id);
}
