import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { inListCheck, timestamps } from "./helpers.ts";
import { ATTACHMENT_ACCESS, ATTACHMENT_ORIGIN, ATTACHMENT_OWNER } from "./vocabulary.ts";

/**
 * Attachments — every file in Vercel Blob, and which row it belongs to
 * (spec §4.7).
 *
 * The owner is polymorphic (`owner_type` + `owner_id`), so there is no foreign
 * key; a test walk checks integrity instead. Both columns are null together
 * while a file is uploaded but not yet attached to anything; the daily cron
 * deletes those after 24 hours.
 *
 * `source_key` is the import's idempotency key — `<notion page id>:<property>:
 * <index>` — so a re-run recognises a file it already copied instead of
 * uploading it twice. Null on files uploaded through the app.
 *
 * `origin` says how the file came to be stored (`ATTACHMENT_ORIGIN`), and
 * `source_url` where its bytes came from: the manufacturer's link for an
 * archived manual, the image's URL for a chosen product image, the original's
 * URL for a background-removed copy (gateway spec §4.2). Both are null on rows
 * written before migration `0008`, except archived manuals, which it backfills
 * from their `source_key`.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerType: text("owner_type"),
    ownerId: uuid("owner_id"),
    position: integer("position").notNull().default(0),
    blobPathname: text("blob_pathname").notNull(),
    access: text("access").notNull(),
    publicUrl: text("public_url"),
    contentType: text("content_type"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    originalFilename: text("original_filename"),
    sourceKey: text("source_key").unique(),
    origin: text("origin"),
    sourceUrl: text("source_url"),
    uploadedBy: text("uploaded_by"),
    ...timestamps(),
  },
  (t) => [
    inListCheck("attachments_owner_type_check", "owner_type", ATTACHMENT_OWNER),
    inListCheck("attachments_access_check", "access", ATTACHMENT_ACCESS),
    inListCheck("attachments_origin_check", "origin", ATTACHMENT_ORIGIN),
    index("attachments_owner_idx").on(t.ownerType, t.ownerId, t.position),
  ]
);
