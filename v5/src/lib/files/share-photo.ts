import { and, eq, inArray } from "drizzle-orm";
import { getBlobStore, isBlobConfigured, type BlobStore } from "../blob";
import { getDb } from "../db/client";
import { attachments } from "../db/schema/index";
import type { Db } from "../db/types";
import { isUuid } from "../data/uuid";

/**
 * One photo, several items (data platform spec amendment "Many items at
 * once"): a picture of a bench with a drill press, a Cricut and two batteries
 * on it shows four pending items, and each should offer it as "Your photo".
 *
 * An `attachments` row has **one** owner, and its bytes are deleted with it —
 * by the orphan sweep after a discard, by promotion's "delete the private
 * original", by approval's re-own. Two rows pointing at one blob would let one
 * item's discard delete another item's picture. So the photo is **copied**:
 * the first item keeps the upload (it claims it as ever); every other item that
 * shows it gets its own public copy at a random pathname, with its own row
 * (`copyToPublic`, the same verb promotion uses — a chat upload is private, and
 * a photo on a pending tool is public, §3.3).
 *
 * The rules, in order:
 *
 * - **Only a photo one of these items already holds.** The source must be
 *   owned by one of `ownerIds` (the batch that was just written) and uploaded
 *   by `uploadedBy` — the claim's own ownership rule, so an id typed into a
 *   message can never copy somebody else's picture.
 * - **Copy, then the row.** A copy whose row cannot be written is deleted
 *   again, best-effort, so no public file is left that no row knows about.
 * - **Best-effort.** The pending rows are already committed; a copy that fails
 *   is counted and the caller says so (Article 4). Never throws for one photo.
 *
 * Copy before promotion: promotion deletes the private original once the
 * first item's row points at its public copy.
 */

/** Where the copies go — the same prefix promotion uses. */
const PUBLIC_PREFIX = "uploads/tool/";

export interface ShareRequest {
  /** The upload to copy — held by another item of the batch. */
  attachmentId: string;
  /** The pending item that should also show it. */
  ownerId: string;
  /** Its position among that item's photos. */
  position: number;
}

export interface ShareOptions {
  db?: Db;
  store?: BlobStore;
  /** The caller: only their own uploads are copied. */
  uploadedBy: string;
  /** The batch's items: a source must be owned by one of them. */
  ownerIds: readonly string[];
}

export interface ShareResult {
  /** New rows written, one per request that landed. */
  shared: number;
  /** Requests that were refused (not the caller's, not in the batch) or failed. */
  failed: number;
}

export async function sharePhotosWithItems(requests: readonly ShareRequest[], options: ShareOptions): Promise<ShareResult> {
  const result: ShareResult = { shared: 0, failed: 0 };
  const wanted = requests.filter((r) => isUuid(r.attachmentId) && isUuid(r.ownerId));
  result.failed += requests.length - wanted.length;
  if (wanted.length === 0) return result;

  const store = options.store ?? (isBlobConfigured() ? getBlobStore() : null);
  if (!store) return { shared: 0, failed: requests.length };

  const db = options.db ?? (await getDb());
  const owners = options.ownerIds.filter(isUuid);
  const sources = owners.length
    ? await db
        .select()
        .from(attachments)
        .where(
          and(
            inArray(attachments.id, [...new Set(wanted.map((r) => r.attachmentId))]),
            eq(attachments.ownerType, "pending_tool"),
            inArray(attachments.ownerId, owners),
            eq(attachments.uploadedBy, options.uploadedBy)
          )
        )
    : [];
  const byId = new Map(sources.map((row) => [row.id, row]));

  for (const request of wanted) {
    const source = byId.get(request.attachmentId);
    if (!source || !owners.includes(request.ownerId) || source.ownerId === request.ownerId) {
      result.failed += 1;
      continue;
    }

    let copied: { pathname: string; url: string };
    try {
      copied = await store.copyToPublic(source.blobPathname, PUBLIC_PREFIX);
    } catch (err) {
      console.error(`[share-photo] could not copy attachment ${source.id}`, err);
      result.failed += 1;
      continue;
    }

    try {
      await db.insert(attachments).values({
        ownerType: "pending_tool",
        ownerId: request.ownerId,
        position: request.position,
        blobPathname: copied.pathname,
        access: "public",
        publicUrl: copied.url,
        contentType: source.contentType,
        sizeBytes: source.sizeBytes,
        width: source.width,
        height: source.height,
        originalFilename: source.originalFilename,
        origin: source.origin ?? "upload",
        uploadedBy: source.uploadedBy,
      });
      result.shared += 1;
    } catch (err) {
      console.error(`[share-photo] could not record the copy of ${source.id}`, err);
      result.failed += 1;
      await store.del([copied.pathname], "public").catch((cause: unknown) => {
        console.error(`[share-photo] could not delete unused copy ${copied.pathname}`, cause);
      });
    }
  }
  return result;
}
