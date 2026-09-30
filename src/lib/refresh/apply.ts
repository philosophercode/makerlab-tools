import "server-only";

import type { BlobStore } from "../blob";
import type { Revision } from "../data/revision";
import type { Db } from "../db/types";
import { storeResearchImage } from "../intake/approval-image";
import type { PickHints } from "../research/images/pick-clean";
import { BACKGROUND_CLASSES, type BackgroundClass } from "../research/result";
import { attachPhotos } from "../inventory/photo-edits";
import { addResource } from "../inventory/resource-edits";
import type { InventoryWriteError, InventoryWriteWarning } from "../inventory/result";
import { saveToolFields } from "../inventory/tool-edits";
import { patchFor, proposedResource } from "./decide";
import { replacesLabRule } from "./lab-rules";
import { hasVerifiedEvidence, isActionable, type FieldProposal, type ProposedCover } from "./types";

/**
 * Accepting proposals: **the tool editor's own save path** (refresh research
 * spec §3.3, §12.2).
 *
 * - **Fields** — every accepted field proposal becomes one editor patch,
 *   saved by `saveToolFields` against the revision the proposals were made at
 *   (`base_revision`). If the tool changed since, nothing is written and the
 *   answer is `conflict`: the caller shows the record's values now and the
 *   admin decides again. The catalogue is invalidated inside, as for any edit.
 * - **Resources** — each through the editor's add-resource write, which
 *   touches the tool at the revision the field save just returned, so the
 *   chain of writes is one person's edits in order.
 * - **Cover photo** — the image research ranked first is downloaded **now**,
 *   through the SSRF guard (`storeResearchImage`, the approval image path),
 *   **cleaned** the way intake's picked image is (the deterministic crop and
 *   cutout, from the hints the proposal recorded — amendment "The picked image
 *   is cleaned too"), stored public and attached as the tool's photo; with no
 *   other photo it is the cover. A download that fails is the `image_not_attached` warning on a
 *   landed write, never a refusal.
 *
 * What is refused before anything is written: a proposal that is not a change
 * (`unverified`), a quoted field whose quotes were all not found
 * (`unverified_quote` — §4.2: the admin opens the editor instead), and a name
 * change on a published tool by someone without `tools.publish`
 * (`not_permitted`), and a proposal that would remove or replace one of the
 * lab's rules — a restriction line or a "training required" (`replaces_lab_rule`,
 * `lab-rules.ts`; only a proposal stored before that rule, or hand-edited, can
 * be one). Accept-all drops those itself; a single Accept is told.
 *
 * No audit event: accepting a proposal is an ordinary edit (§3.3, data
 * platform spec §4.11). The caller records who decided what on the refresh or
 * chat-proposal row, triggers the mirror and archives new manuals.
 */

export interface ApplyContext {
  toolId: string;
  baseRevision: Revision;
  actorUserId: string | null;
  /** Whether the person may publish — needed to rename a published tool (§8). */
  canPublish: boolean;
  toolPublished: boolean;
  db?: Db;
  /** The Blob seam, for the cover photo. Omitted: the configured store. */
  store?: BlobStore | null;
}

export type ApplyRefusal =
  | "conflict"
  | "not_found"
  | "invalid_field"
  | "duplicate_name"
  | "not_permitted"
  | "unverified_quote"
  | "replaces_lab_rule"
  | "failed";

export type ApplyResult =
  | {
      ok: true;
      /** The tool's revision after every write. */
      revision: Revision;
      /** Ids of the proposals written. */
      applied: string[];
      /** The resources created, for the manual archive. */
      resourceIds: string[];
      warning?: InventoryWriteWarning;
    }
  | { ok: false; error: ApplyRefusal };

/** Why one proposal cannot be accepted, or null when it can. */
export function refusalFor(
  p: FieldProposal,
  ctx: Pick<ApplyContext, "canPublish" | "toolPublished"> & {
    /** A pending item's restrictions and training flag are research's drafts, not lab rules. Default `"tool"`. */
    subjectKind?: "tool" | "pending";
  }
): ApplyRefusal | null {
  if (!isActionable(p)) return "invalid_field";
  if (!hasVerifiedEvidence(p)) return "unverified_quote";
  if ((ctx.subjectKind ?? "tool") === "tool" && replacesLabRule(p)) return "replaces_lab_rule";
  if (p.field === "name" && ctx.toolPublished && !ctx.canPublish) return "not_permitted";
  return null;
}

export async function applyProposals(proposals: readonly FieldProposal[], ctx: ApplyContext): Promise<ApplyResult> {
  for (const p of proposals) {
    const refusal = refusalFor(p, ctx);
    if (refusal) return { ok: false, error: refusal };
  }

  let revision = ctx.baseRevision;
  const applied: string[] = [];
  const resourceIds: string[] = [];
  let warning: InventoryWriteWarning | undefined;

  const fields = proposals.filter((p) => p.field !== "resource" && p.field !== "cover_photo");
  const patch = patchFor(fields);
  if (Object.keys(patch).length > 0) {
    const saved = await saveToolFields({
      toolId: ctx.toolId,
      patch,
      expectedRevision: revision,
      actorUserId: ctx.actorUserId,
      db: ctx.db,
    });
    if (!saved.ok) return { ok: false, error: toRefusal(saved.error) };
    revision = saved.revision;
    applied.push(...fields.map((p) => p.id));
  } else if (fields.length > 0) {
    return { ok: false, error: "invalid_field" };
  }

  for (const p of proposals.filter((proposal) => proposal.field === "resource")) {
    const resource = proposedResource(p);
    if (!resource) return partialOrRefusal(applied, revision, resourceIds, "invalid_field");
    const added = await addResource(
      { toolId: ctx.toolId, expectedRevision: revision, actorUserId: ctx.actorUserId, db: ctx.db },
      { title: resource.title.slice(0, 300), url: resource.url, type: resource.type, published: true }
    );
    if (!added.ok) return partialOrRefusal(applied, revision, resourceIds, toRefusal(added.error));
    revision = added.revision;
    resourceIds.push(added.resourceId);
    applied.push(p.id);
  }

  const cover = proposals.find((p) => p.field === "cover_photo");
  if (cover) {
    const proposed = cover.proposed as Partial<ProposedCover> | undefined;
    const coverId =
      typeof proposed?.url === "string" && ctx.actorUserId
        ? await storeResearchImage(
            proposed.url,
            { uploadedBy: ctx.actorUserId, db: ctx.db, store: ctx.store },
            coverHints(proposed)
          )
        : null;
    if (!coverId) {
      warning = "image_not_attached";
    } else {
      const attached = await attachPhotos(
        { toolId: ctx.toolId, expectedRevision: revision, actorUserId: ctx.actorUserId, db: ctx.db },
        [coverId]
      );
      if (!attached.ok) return partialOrRefusal(applied, revision, resourceIds, toRefusal(attached.error));
      revision = attached.revision;
      if (attached.photosAttached === 0) warning = "image_not_attached";
    }
    applied.push(cover.id);
  }

  return { ok: true, revision, applied, resourceIds, ...(warning ? { warning } : {}) };
}

/**
 * The cleaning hints a stored cover proposal carries, read leniently: the row
 * is JSON (a proposal from before the hints, or hand-edited), so anything not
 * the right shape is simply absent — the background is then classified, and a
 * box `cleanPickedImage` cannot validate is no box.
 */
function coverHints(proposed: Partial<ProposedCover>): PickHints {
  const background = BACKGROUND_CLASSES.includes(proposed.background as BackgroundClass)
    ? (proposed.background as BackgroundClass)
    : null;
  const box = Array.isArray(proposed.productBox) ? proposed.productBox : null;
  return { background, composite: proposed.composite === true, productBox: box };
}

/**
 * A later write refused after an earlier one landed: the earlier ones are in
 * the database, so the answer is a success for them (never `ok: false` for a
 * write that landed — Article 4); the refused proposal stays undecided.
 */
function partialOrRefusal(applied: string[], revision: Revision, resourceIds: string[], error: ApplyRefusal): ApplyResult {
  if (applied.length === 0) return { ok: false, error };
  return { ok: true, revision, applied, resourceIds };
}

/** The editor's refusal in this path's words: its three meaningful codes, else `failed`. */
function toRefusal(error: InventoryWriteError): ApplyRefusal {
  return error === "conflict" || error === "not_found" || error === "invalid_field" || error === "duplicate_name"
    ? error
    : "failed";
}
