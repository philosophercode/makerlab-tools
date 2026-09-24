import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
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
 * `uploadedBy`, when given, adds a third: only rows that person uploaded. A
 * caller whose ids come from text the person typed — the chat's
 * `[Attached photos: ...]` hint — passes it, because an unowned upload id is
 * not a secret once it has been pasted anywhere, and an unclaimed upload can
 * be a private photo of a person (§3.3).
 *
 * The count comes back so the caller can tell the difference between "no photos
 * were sent" and "photos were sent and none of them stuck", which is the
 * difference between saying nothing and saying so (Article 4).
 */
export async function claimAttachments(
  db: Db,
  ids: readonly string[],
  owner: ClaimOwner,
  options: { uploadedBy?: string } = {}
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
      .where(
        and(
          eq(attachments.id, id),
          isNull(attachments.ownerId),
          options.uploadedBy === undefined ? undefined : eq(attachments.uploadedBy, options.uploadedBy)
        )
      )
      .returning({ id: attachments.id });
    claimed += rows.length;
  }
  return claimed;
}

/**
 * Every file this owner holds, cover first (`position` 0 is the cover, §4.7).
 *
 * Takes its handle explicitly for the same reason {@link claimAttachments}
 * does: the editor reads an owner's photos inside the transaction that is about
 * to reorder them.
 */
export async function listAttachmentsForOwner(
  db: Db,
  owner: ClaimOwner
): Promise<StoredAttachment[]> {
  if (!isUuid(owner.ownerId)) return [];
  return db
    .select(ATTACHMENT_COLUMNS)
    .from(attachments)
    .where(and(eq(attachments.ownerType, owner.ownerType), eq(attachments.ownerId, owner.ownerId)))
    .orderBy(asc(attachments.position), asc(attachments.id));
}

/**
 * Rewrite this owner's photo order, and report how many rows moved.
 *
 * `orderedIds` is the whole order the panel is asserting; whatever is at the
 * front becomes the cover. Two rules, both about not trusting the list:
 *
 * - **Owner-scoped.** `owner_type` and `owner_id` are part of every WHERE, so
 *   an id belonging to another tool changes nothing — a reorder cannot reach
 *   across records.
 * - **Anything not named is left alone.** A photo added by somebody else while
 *   the panel was open keeps its position rather than being silently dropped to
 *   the end of a list that never knew about it.
 */
export async function reorderAttachments(
  db: Db,
  owner: ClaimOwner,
  orderedIds: readonly string[]
): Promise<number> {
  if (!isUuid(owner.ownerId)) return 0;
  const candidates = [...new Set(orderedIds.filter(isUuid))];
  if (candidates.length === 0) return 0;

  let moved = 0;
  // One statement per id, as in `claimAttachments` and for the same reason:
  // `position` is the caller's order, and the panel is capped at a handful of
  // photos (§3.3).
  for (const [position, id] of candidates.entries()) {
    const rows = await db
      .update(attachments)
      .set({ position })
      .where(
        and(
          eq(attachments.id, id),
          eq(attachments.ownerType, owner.ownerType),
          eq(attachments.ownerId, owner.ownerId)
        )
      )
      .returning({ id: attachments.id });
    moved += rows.length;
  }
  return moved;
}

/**
 * Take files off their owner — the inverse of {@link claimAttachments} — and
 * report how many were released.
 *
 * **This is how a photo is removed, and the bytes are not deleted here.** An
 * unowned row is exactly what `POST /api/uploads` leaves behind, so the daily
 * cron's existing sweep (`listOrphanedAttachments` → blob, then row) collects
 * it, in that order, with the retry behaviour that path already has. Deleting
 * the blob from inside a request would either sit inside a transaction that can
 * still roll back, or commit ahead of a write that can still fail — and a blob
 * whose row is gone is invisible to every sweep there is.
 *
 * The trade is that the bytes outlive the removal by up to a day. The photo
 * leaves the page the moment this commits, which is what "remove" means to the
 * person clicking it.
 *
 * Omit `ids` to release everything this owner holds — what deleting the owning
 * row needs, so its files become sweepable instead of pointing at nothing.
 */
export async function releaseAttachments(
  db: Db,
  owner: ClaimOwner,
  ids?: readonly string[]
): Promise<number> {
  if (!isUuid(owner.ownerId)) return 0;

  const owned = and(
    eq(attachments.ownerType, owner.ownerType),
    eq(attachments.ownerId, owner.ownerId)
  );

  let where = owned;
  if (ids !== undefined) {
    const candidates = [...new Set(ids.filter(isUuid))];
    if (candidates.length === 0) return 0;
    where = and(owned, inArray(attachments.id, candidates));
  }

  const rows = await db
    .update(attachments)
    // `position` goes back to the default too: the row is about to be swept,
    // and leaving a stale cover position on it would be a small lie in the one
    // table the integrity walk reads.
    .set({ ownerType: null, ownerId: null, position: 0 })
    .where(where)
    .returning({ id: attachments.id });

  return rows.length;
}

/**
 * Move every file from one owner to another, keeping their order, and report
 * how many moved — what approving a pending tool does with its photos (§4.7:
 * "the bytes do not move").
 *
 * The files land **after** whatever `to` already holds: approving a second
 * unit of an existing tool appends its photos rather than replacing that
 * tool's cover. One statement, so the new positions are computed against the
 * same snapshot the move happens in.
 *
 * Takes its handle explicitly: approval re-owns inside the transaction that
 * creates the tool, so a rollback leaves the photos on the pending item.
 */
export async function reownAttachments(
  db: Db,
  from: ClaimOwner,
  to: ClaimOwner
): Promise<number> {
  if (!isUuid(from.ownerId) || !isUuid(to.ownerId)) return 0;

  const rows = await rawRows<{ id: string }>(
    db,
    sql`
      update attachments a
         set owner_type = ${to.ownerType},
             owner_id = ${to.ownerId}::uuid,
             position = base.next + moving.rn - 1
        from (
               select id, row_number() over (order by position, id) as rn
                 from attachments
                where owner_type = ${from.ownerType} and owner_id = ${from.ownerId}::uuid
             ) moving,
             (
               select coalesce(max(position) + 1, 0) as next
                 from attachments
                where owner_type = ${to.ownerType} and owner_id = ${to.ownerId}::uuid
             ) base
       where a.id = moving.id
      returning a.id
    `
  );
  return rows.length;
}

/**
 * Record that a file is now public: its new pathname and the URL anybody can
 * follow. For a photo uploaded privately (the chat's uploads are) that is
 * about to appear on a public tool page — the caller copies the bytes to a
 * public blob first, then says so here.
 *
 * The old private pathname is no longer referenced by any row once this
 * commits, so no sweep will ever find it: deleting that blob is the caller's
 * job, after this returns true.
 *
 * True when the row existed and was updated.
 */
export async function markAttachmentPublic(
  db: Db,
  id: string,
  blob: { blobPathname: string; publicUrl: string }
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .update(attachments)
    .set({ access: "public", blobPathname: blob.blobPathname, publicUrl: blob.publicUrl })
    .where(eq(attachments.id, id))
    .returning({ id: attachments.id });
  return rows.length > 0;
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
