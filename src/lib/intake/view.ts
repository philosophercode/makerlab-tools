import type { IntakeQueueSummary, PendingTool } from "../data/pending-tools";
import type { PendingStatus } from "../db/schema/vocabulary";
import type { FoundPhoto } from "./found-photo";
import { IDENTIFY_PHOTO_STALE_MS } from "./limits";
import type { FoundPhotoView, PendingToolView } from "./types";

/**
 * A pending item as the browser may see it (spec §5.4, §8 PII).
 *
 * The one place a `PendingTool` becomes a {@link PendingToolView}, so every
 * surface — the chat card, the PATCH route, the intake list — sends the same
 * shape. What it leaves out is deliberate: the research result itself (the
 * preliminary page reads that server-side), and every id that names a person.
 * The owner travels as a display name only.
 *
 * Client-safe: every import is type-only but `./limits` (`access.test.ts`
 * holds it to that), so the found photo's view helpers live here too.
 */
export function toPendingToolView(item: PendingTool): PendingToolView {
  return {
    id: item.id,
    batchId: item.batchId,
    status: item.status,
    name: item.name,
    brand: item.brand,
    categoryHint: item.categoryHint,
    locationHint: item.locationHint,
    serialNumber: item.serialNumber,
    duplicateOf: item.duplicateOf,
    duplicateResolution: item.duplicateResolution,
    photos: item.photos.map((photo) => ({
      attachmentId: photo.attachmentId,
      url: photo.url,
      filename: photo.filename,
    })),
    quantity: item.quantity,
    identifyConfidence: item.identifyConfidence,
    seenIn: item.seenIn,
    foundPhoto: toFoundPhotoView(item.id, item.status, item.foundPhoto),
    confidenceLevel: item.research?.confidence.level ?? null,
    researchError: item.researchError,
    researchRequestedAt: item.researchRequestedAt?.toISOString() ?? null,
    hasWorkflowRun: item.workflowRunId !== null,
    createdByName: item.createdByName,
    createdByRemoved: item.createdByRemoved,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

/**
 * The intake list's slim row (`listIntakeQueueSummaries`) as the browser sees
 * it — the same shape {@link toPendingToolView} gives the full item.
 */
export function summaryToPendingToolView(item: IntakeQueueSummary): PendingToolView {
  return {
    id: item.id,
    batchId: item.batchId,
    status: item.status,
    name: item.name,
    brand: item.brand,
    categoryHint: item.categoryHint,
    locationHint: item.locationHint,
    serialNumber: item.serialNumber,
    duplicateOf: item.duplicateOf,
    duplicateResolution: item.duplicateResolution,
    photos: item.photos.map((photo) => ({
      attachmentId: photo.attachmentId,
      url: photo.url,
      filename: photo.filename,
    })),
    quantity: item.quantity,
    identifyConfidence: item.identifyConfidence,
    seenIn: item.seenIn,
    foundPhoto: toFoundPhotoView(item.id, item.status, item.foundPhoto),
    confidenceLevel: item.confidenceLevel,
    researchError: item.researchError,
    researchRequestedAt: item.researchRequestedAt?.toISOString() ?? null,
    hasWorkflowRun: item.hasWorkflowRun,
    createdByName: item.createdByName,
    createdByRemoved: item.createdByRemoved,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

/**
 * The looked-up photo as a browser may show it (amendment "A photo for a
 * name"), or null: no lookup, or the item is settled — an approved tool has
 * its own cover, a discarded item nothing. The cleaned copy is private and
 * loads through `foundPhotoPath`; without one the picture loads from its own
 * host, sending no referrer.
 */
export function toFoundPhotoView(id: string, status: PendingStatus, photo: FoundPhoto | null): FoundPhotoView | null {
  if (!photo || status === "approved" || status === "discarded") return null;
  const effective = effectiveFoundPhotoStatus(photo);
  const empty: FoundPhotoView = { status: effective, src: null, external: false, host: null, pageUrl: null, cleaned: false };
  if (effective !== "found") return empty;
  if (!photo.candidate) return { ...empty, status: "none" };
  const attribution = { host: foundPhotoHost(photo.candidate), pageUrl: photo.candidate.pageUrl };
  return photo.cleaned
    ? { status: "found", src: foundPhotoPath(id), external: false, cleaned: true, ...attribution }
    : { status: "found", src: photo.candidate.url, external: true, cleaned: false, ...attribution };
}

/** A lookup marked searching that has gone on too long to still be running. */
export function foundPhotoStale(photo: Pick<FoundPhoto, "status" | "requestedAt">, now: number = Date.now()): boolean {
  if (photo.status !== "searching") return false;
  const asked = Date.parse(photo.requestedAt);
  return !Number.isFinite(asked) || now - asked > IDENTIFY_PHOTO_STALE_MS;
}

/** The status a reader should act on: a stale search reads as failed. */
export function effectiveFoundPhotoStatus(
  photo: Pick<FoundPhoto, "status" | "requestedAt">,
  now: number = Date.now()
): FoundPhoto["status"] {
  return foundPhotoStale(photo, now) ? "failed" : photo.status;
}

/** Where a browser loads the private cleaned copy — behind `canActOnPendingTool`. */
export function foundPhotoPath(pendingId: string): string {
  return `/api/pending-tools/${pendingId}/found-photo`;
}

/** The bare host a picture came from — its page's, else its own — for "Found online · host". */
export function foundPhotoHost(candidate: { url: string; pageUrl: string | null }): string | null {
  for (const href of [candidate.pageUrl, candidate.url]) {
    if (!href) continue;
    try {
      const url = new URL(href);
      if (url.protocol === "http:" || url.protocol === "https:") return url.hostname.replace(/^www\./, "");
    } catch {
      // Not a URL; try the next.
    }
  }
  return null;
}
