import { and, eq } from "drizzle-orm";
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
 *   `upload`, or null on a row written before migration `0008`. It is
 *   identification evidence and one of the image choices, never a reason to
 *   skip the image stage (amendment "An uploaded photo is a choice, not the
 *   product image").
 * - **the cleaned copy** — `research_image_cleaned`: the one file the stage
 *   writes before anybody decides (§3.5), private, its `source_url` the
 *   original image's URL; or the cutout of an uploaded photo an approval
 *   chose with its background removed ({@link recordUploadCutout}), public,
 *   with no `source_url`.
 *
 * Every function takes its handle explicitly, like the claim helpers it uses.
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`: the research workflow's step code calls this.
 */

const PENDING = "pending_tool" as const;

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

export interface UploadCutoutRecord {
  pendingId: string;
  /** The public pathname the store chose, random suffix included. */
  blobPathname: string;
  publicUrl: string;
  sizeBytes: number;
  width: number;
  height: number;
  /** Who uploaded the photo it was cut from. */
  uploadedBy: string | null;
  /** The photo's own file name, for the copy's. */
  filename: string;
}

/**
 * Record the background-removed copy of an uploaded photo that an approval is
 * about to make the cover — **public** (it is stored at approval, straight to
 * the public store), a PNG, owned by the pending item as its
 * `research_image_cleaned` copy so the approval's `takeCover` can take it and
 * `releaseUnchosenCleaned` lets it go if a later approval chooses otherwise.
 * No `source_url`: it came from the item's own photo, not a web page. One
 * transaction, as {@link recordCleanedImage}.
 */
export async function recordUploadCutout(db: Db, record: UploadCutoutRecord): Promise<string> {
  if (!isUuid(record.pendingId)) throw new Error("The photo's cutout could not be attached to its pending item.");
  return db.transaction(async (tx) => {
    const { id } = await createAttachment(
      {
        blobPathname: record.blobPathname,
        access: "public",
        publicUrl: record.publicUrl,
        contentType: "image/png",
        sizeBytes: record.sizeBytes,
        originalFilename: record.filename,
        uploadedBy: record.uploadedBy,
        origin: "research_image_cleaned",
        sourceUrl: null,
        width: record.width,
        height: record.height,
      },
      { db: tx }
    );
    const claimed = await claimAttachments(tx, [id], { ownerType: PENDING, ownerId: record.pendingId });
    if (claimed !== 1) throw new Error("The photo's cutout could not be attached to its pending item.");
    return id;
  });
}
