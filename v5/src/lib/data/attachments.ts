import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { attachments } from "../db/schema/index.ts";
import type { AttachmentAccess, AttachmentOwner } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Attachment ownership (spec §3.3, §4.7).
 *
 * A file uploaded through the app lands in Blob and gets an `attachments` row
 * with **no owner**: at upload time the ticket or the project it belongs to
 * does not exist yet. The write that creates that row then *claims* its
 * uploads, which is what turns a loose file into a photo on a record. Anything
 * still unclaimed after 24 hours is what the daily cron sweeps up.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

export interface ClaimOwner {
  ownerType: AttachmentOwner;
  /** The row that now owns these files. */
  ownerId: string;
}

/**
 * Stamp `ids` with an owner, in the order given, and report how many were
 * actually claimed.
 *
 * Takes its handle explicitly rather than calling `getDb()`, because every
 * caller claims inside the same transaction that inserts the owning row: a
 * ticket that rolls back must not leave its photos pointing at a row that was
 * never committed.
 *
 * Two rules, both of them about not trusting the caller's ids:
 *
 * - **Only unowned rows are claimed.** `owner_id is null` is part of the WHERE,
 *   so a replayed submission carrying somebody else's attachment id moves
 *   nothing — a student cannot annex another student's photos by guessing.
 * - **Non-uuid ids are dropped here**, not handed to Postgres, which would
 *   answer a uuid cast error rather than an empty result.
 *
 * The count comes back so the caller can tell the difference between "no photos
 * were sent" and "photos were sent and none of them stuck", which is the
 * difference between saying nothing and saying so (Article 4).
 */
export async function claimAttachments(
  db: Db,
  ids: readonly string[],
  owner: ClaimOwner
): Promise<number> {
  // Deduplicated so a repeated id cannot consume two positions.
  const candidates = [...new Set(ids.filter(isUuid))];
  if (candidates.length === 0) return 0;

  let claimed = 0;
  // One statement per id: `position` is the caller's order, so this is not a
  // set-based update, and the callers are capped at 8 photos each (§3.3).
  for (const [position, id] of candidates.entries()) {
    const rows = await db
      .update(attachments)
      .set({ ownerType: owner.ownerType, ownerId: owner.ownerId, position })
      .where(and(eq(attachments.id, id), isNull(attachments.ownerId)))
      .returning({ id: attachments.id });
    claimed += rows.length;
  }
  return claimed;
}

/** One uploaded file, before anything owns it. */
export interface NewAttachment {
  /** The pathname the store actually chose, random suffix included. */
  blobPathname: string;
  access: AttachmentAccess;
  /** Only a public blob has a URL a viewer can follow; private files are null. */
  publicUrl: string | null;
  contentType: string;
  sizeBytes: number;
  /** As the browser sent it. Display only — never used to address the blob. */
  originalFilename: string;
  /** The signed-in uploader, or null. Anonymous uploads stay allowed (§3.3). */
  uploadedBy: string | null;
}

export interface AttachmentReadOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Record a file that has just landed in Blob.
 *
 * **The owner columns are left null deliberately.** At upload time the ticket
 * or the project the file belongs to does not exist yet — the student is still
 * typing it. The write that creates that row claims its uploads with
 * {@link claimAttachments}; anything never claimed is swept by the daily cron
 * 24 hours later.
 */
export async function createAttachment(
  row: NewAttachment,
  options: AttachmentReadOptions = {}
): Promise<{ id: string }> {
  const db = options.db ?? (await getDb());

  const [created] = await db
    .insert(attachments)
    .values({
      blobPathname: row.blobPathname,
      access: row.access,
      publicUrl: row.publicUrl,
      contentType: row.contentType,
      sizeBytes: row.sizeBytes,
      originalFilename: row.originalFilename,
      uploadedBy: row.uploadedBy,
    })
    .returning({ id: attachments.id });

  return { id: created.id };
}

/** An attachment as the cleanup and the delete paths need to see it. */
export interface StoredAttachment {
  id: string;
  blobPathname: string;
  access: string;
  publicUrl: string | null;
  contentType: string | null;
  originalFilename: string | null;
  ownerType: string | null;
  ownerId: string | null;
  position: number;
}

/**
 * Look several attachments up by id, dropping anything that is not uuid-shaped
 * before Postgres sees it (a uuid column answers a cast error, not an empty
 * result). Order is not guaranteed — callers that care sort by `position`.
 */
export async function findAttachmentsByIds(
  ids: readonly string[],
  options: AttachmentReadOptions = {}
): Promise<StoredAttachment[]> {
  const candidates = [...new Set(ids.filter(isUuid))];
  if (candidates.length === 0) return [];

  const db = options.db ?? (await getDb());
  return db
    .select(ATTACHMENT_COLUMNS)
    .from(attachments)
    .where(inArray(attachments.id, candidates));
}

/**
 * Files nobody claimed, uploaded before `olderThan` (spec §3.3: 24 hours).
 *
 * `owner_id is null` is the whole condition that makes a file an orphan — a
 * claimed photo is somebody's record and is never swept, however old. The
 * cutoff is passed in rather than computed here so the cron's test can stage
 * a row's age without touching the clock.
 */
export async function listOrphanedAttachments(
  olderThan: Date,
  options: AttachmentReadOptions = {}
): Promise<StoredAttachment[]> {
  const db = options.db ?? (await getDb());
  return db
    .select(ATTACHMENT_COLUMNS)
    .from(attachments)
    .where(
      and(isNull(attachments.ownerId), lt(attachments.createdAt, olderThan))
    );
}

/**
 * Remove rows by id, and report how many went.
 *
 * Only ever called *after* the bytes are gone from Blob: a row without a blob
 * is a broken image on a page, while a blob without a row is invisible and gets
 * swept next time. Losing the row first is the worse of the two failures.
 */
export async function deleteAttachments(
  ids: readonly string[],
  options: AttachmentReadOptions = {}
): Promise<number> {
  const candidates = [...new Set(ids.filter(isUuid))];
  if (candidates.length === 0) return 0;

  const db = options.db ?? (await getDb());
  const rows = await db
    .delete(attachments)
    .where(inArray(attachments.id, candidates))
    .returning({ id: attachments.id });
  return rows.length;
}

/** The projection every read here shares — never `select *`, so a new column
 * cannot silently start travelling to a caller that does not expect it. */
const ATTACHMENT_COLUMNS = {
  id: attachments.id,
  blobPathname: attachments.blobPathname,
  access: attachments.access,
  publicUrl: attachments.publicUrl,
  contentType: attachments.contentType,
  originalFilename: attachments.originalFilename,
  ownerType: attachments.ownerType,
  ownerId: attachments.ownerId,
  position: attachments.position,
};
