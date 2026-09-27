import { and, eq, isNull, or } from "drizzle-orm";
import { attachments } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { claimAttachments, createAttachment } from "./attachments.ts";
import { isUuid } from "./uuid.ts";

/**
 * The image stage's rows in `attachments` (gateway spec §3.5, §4.2).
 *
 * A pending item owns two kinds of file, told apart by `origin`:
 *
 * - **an uploaded photo** — what the admin added in the chat: `origin` is
 *   `upload`, or null on a row written before migration `0008`. Its presence
 *   skips the image stage (§5.1: the admin's photo is the cover).
 * - **the cleaned copy** — `research_image_cleaned`, private, the one file the
 *   stage writes before anybody decides (§3.5). Its `source_url` is the
 *   original image's URL.
 *
 * Every function takes its handle explicitly, like the claim helpers it uses.
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`: the research workflow's step code calls this.
 */

const PENDING = "pending_tool" as const;

/** True when the pending item owns a photo somebody uploaded. */
export async function hasUploadedPhoto(db: Db, pendingId: string): Promise<boolean> {
  if (!isUuid(pendingId)) return false;
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, PENDING),
        eq(attachments.ownerId, pendingId),
        or(isNull(attachments.origin), eq(attachments.origin, "upload"))
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Let go of every cleaned copy the item holds, and report how many. The rows
 * lose their owner and the nightly orphan sweep deletes their bytes — so a
 * retried or repeated research never leaves a second copy on the item.
 */
export async function releaseCleanedImages(db: Db, pendingId: string): Promise<number> {
  if (!isUuid(pendingId)) return 0;
  const rows = await db
    .update(attachments)
    .set({ ownerType: null, ownerId: null, position: 0 })
    .where(
      and(
        eq(attachments.ownerType, PENDING),
        eq(attachments.ownerId, pendingId),
        eq(attachments.origin, "research_image_cleaned")
      )
    )
    .returning({ id: attachments.id });
  return rows.length;
}

/**
 * Let go of one cleaned copy, if the item still holds it — the copy the images
 * a **Find a different image** run replaced, or the copy that run made when
 * its result could not be written. True when a row was released.
 */
export async function releaseCleanedImage(db: Db, pendingId: string, attachmentId: string): Promise<boolean> {
  if (!isUuid(pendingId) || !isUuid(attachmentId)) return false;
  const rows = await db
    .update(attachments)
    .set({ ownerType: null, ownerId: null, position: 0 })
    .where(
      and(
        eq(attachments.id, attachmentId),
        eq(attachments.ownerType, PENDING),
        eq(attachments.ownerId, pendingId),
        eq(attachments.origin, "research_image_cleaned")
      )
    )
    .returning({ id: attachments.id });
  return rows.length > 0;
}

export interface CleanedImageRecord {
  pendingId: string;
  /** The pathname the store chose, random suffix included. */
  blobPathname: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** The original image's URL — the attribution, and what the copy is compared with. */
  fromUrl: string;
}

/**
 * Record a cleaned copy that has just landed in Blob — private, a PNG, owned
 * by the pending item — and return its attachment id. One transaction, so a
 * failure never leaves an unowned row pretending to be somebody's upload.
 */
export async function recordCleanedImage(db: Db, record: CleanedImageRecord): Promise<string> {
  if (!isUuid(record.pendingId)) throw new Error("The cleaned image could not be attached to its pending item.");
  return db.transaction(async (tx) => {
    const { id } = await createAttachment(
      {
        blobPathname: record.blobPathname,
        access: "private",
        publicUrl: null,
        contentType: "image/png",
        sizeBytes: record.sizeBytes,
        originalFilename: "background-removed.png",
        uploadedBy: null,
        origin: "research_image_cleaned",
        sourceUrl: record.fromUrl,
        width: record.width,
        height: record.height,
      },
      { db: tx }
    );
    const claimed = await claimAttachments(tx, [id], { ownerType: PENDING, ownerId: record.pendingId });
    if (claimed !== 1) throw new Error("The cleaned image could not be attached to its pending item.");
    return id;
  });
}
