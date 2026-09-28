import type { PendingTool } from "../data/pending-tools";
import type { PendingToolView } from "./types";

/**
 * A pending item as the browser may see it (spec §5.4, §8 PII).
 *
 * The one place a `PendingTool` becomes a {@link PendingToolView}, so every
 * surface — the chat card, the PATCH route, the intake list — sends the same
 * shape. What it leaves out is deliberate: the research result itself (the
 * preliminary page reads that server-side), and every id that names a person.
 * The owner travels as a display name only.
 *
 * Client-safe: the `PendingTool` import is type-only.
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
