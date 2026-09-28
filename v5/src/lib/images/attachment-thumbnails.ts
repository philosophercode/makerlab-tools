import { put } from "@vercel/blob";
import { and, asc, eq, inArray, isNotNull, isNull, like, not, sql, type SQL } from "drizzle-orm";
import { createLocalBlobBackend } from "../blob-local.ts";
import { blobCredentials, blobMode } from "../blob-mode.ts";
import { getDb } from "../db/client.ts";
import { attachments } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import type { SharpLoader } from "../research/images/downscale.ts";
import type { ImageThumbnails } from "./thumbnail-urls.ts";
import { renderThumbnails, thumbnailHash } from "./thumbnails.ts";

/**
 * Thumbnails for public images in Blob — uploads, research images, product
 * images (`./thumbnail-urls.ts` says what they are).
 *
 * Written **once, when the image becomes public**: `/api/uploads` after it
 * answers, intake approval and refresh after they commit (`ensureThumbnails`,
 * run through `afterResponse` so nobody waits for the encoder), and
 * `npm run thumbnails:backfill` for rows that predate this or whose run
 * failed. Until a row has them, pages show the original through `next/image`,
 * so a missing or failed set costs bytes, never a broken image.
 *
 * The files sit beside the original under `thumbs/<original pathname
 * without its extension>.<content hash>.<width>.<format>`: public, at a fixed
 * pathname (no random suffix — the original's already is one), cached for a
 * year. The row's `thumbnails` column records the base URL and widths; the
 * daily sweep deletes them with an orphaned original (`thumbnailBlobPathnames`
 * in `./thumbnail-urls.ts`).
 *
 * Plain Node (relative imports, no `server-only`): the backfill script loads it.
 */

/** A thumbnail never changes at its pathname, so it may be cached for a year. */
export const THUMBNAIL_CACHE_SECONDS = 31_536_000;

/** An original larger than this is not downloaded for thumbnails (uploads cap at 18 MB). */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

const SOURCE_TIMEOUT_MS = 20_000;

/** What a thumbnail run needs from a store: the original's bytes, and a public write. */
export interface ThumbnailIO {
  read(row: { blobPathname: string; publicUrl: string }): Promise<Uint8Array | null>;
  write(pathname: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
}

/**
 * The store `blobMode()` allows: Vercel Blob (the original read from its
 * public URL), the local `.blob-data/` folder, or null with no store — then
 * there is nothing to write to and every call here is a no-op.
 */
export function createThumbnailIO(): ThumbnailIO | null {
  switch (blobMode()) {
    case "vercel":
      return {
        async read(row) {
          const response = await fetch(row.publicUrl, { signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
          if (!response.ok) return null;
          const length = Number(response.headers.get("content-length") ?? 0);
          if (length > MAX_SOURCE_BYTES) return null;
          const bytes = new Uint8Array(await response.arrayBuffer());
          return bytes.byteLength > MAX_SOURCE_BYTES ? null : bytes;
        },
        async write(pathname, bytes, contentType) {
          const result = await put(pathname, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
            ...blobCredentials("public"),
            access: "public",
            contentType,
            addRandomSuffix: false,
            allowOverwrite: true,
            cacheControlMaxAge: THUMBNAIL_CACHE_SECONDS,
          });
          return { url: result.url };
        },
      };
    case "local": {
      const disk = createLocalBlobBackend();
      return {
        async read(row) {
          const blob = await disk.read(row.blobPathname).catch(() => null);
          return blob && blob.meta.access === "public" ? blob.body : null;
        },
        async write(pathname, bytes, contentType) {
          const stored = await disk.put(pathname, bytes, { access: "public", contentType, addRandomSuffix: false, allowOverwrite: true });
          return { url: stored.url };
        },
      };
    }
    default:
      return null;
  }
}

/** `thumbs/<pathname without extension>.<hash>` — every file of the set adds `.<width>.<format>`. */
export function thumbnailStem(blobPathname: string, hash: string): string {
  const slash = blobPathname.lastIndexOf("/");
  const dot = blobPathname.lastIndexOf(".");
  const withoutExtension = dot > slash + 1 ? blobPathname.slice(0, dot) : blobPathname;
  return `thumbs/${withoutExtension}.${hash}`;
}

export interface ThumbnailCandidate {
  id: string;
  blobPathname: string;
  publicUrl: string;
}

export interface ThumbnailDeps {
  db?: Db;
  /** Defaults to `createThumbnailIO()`; null means no store, and nothing is done. */
  io?: ThumbnailIO | null;
  loadSharp?: SharpLoader;
}

/**
 * Render, store and record one attachment's thumbnails. Null (and nothing
 * recorded) when the original cannot be read or decoded, or a write fails —
 * the row keeps showing its original. Files already written by a failed run
 * are overwritten by the next one, at the same pathnames.
 */
export async function writeAttachmentThumbnails(row: ThumbnailCandidate, deps: ThumbnailDeps = {}): Promise<ImageThumbnails | null> {
  const io = deps.io === undefined ? createThumbnailIO() : deps.io;
  if (!io) return null;
  const source = await io.read(row).catch(() => null);
  if (!source) return null;
  const rendered = await renderThumbnails(source, { loadSharp: deps.loadSharp });
  if (!rendered) return null;

  const stem = thumbnailStem(row.blobPathname, thumbnailHash(source));
  let base: string | null = null;
  try {
    for (const r of rendered.renditions) {
      const suffix = `.${r.width}.${r.format}`;
      const { url } = await io.write(`${stem}${suffix}`, r.bytes, r.contentType);
      // Every file shares one base; the store decides the origin.
      const own = url.endsWith(suffix) ? url.slice(0, -suffix.length) : null;
      if (!own || (base !== null && own !== base)) return null;
      base = own;
    }
  } catch (err) {
    console.error(`[thumbnails] could not store the thumbnails of attachment ${row.id}`, err);
    return null;
  }
  if (!base) return null;

  const thumbnails: ImageThumbnails = { base, widths: rendered.widths, width: rendered.width, height: rendered.height };
  const db = deps.db ?? (await getDb());
  await db.update(attachments).set({ thumbnails }).where(eq(attachments.id, row.id));
  return thumbnails;
}

/**
 * Which rows need thumbnails: public images in Blob with none yet. A bundled
 * photo's row (`/tool-images/…`, a relative URL) is not one — its thumbnails
 * are in the repository.
 */
export function needsThumbnails(): SQL {
  return and(
    eq(attachments.access, "public"),
    isNotNull(attachments.publicUrl),
    not(like(attachments.publicUrl, "/%")),
    like(attachments.contentType, "image/%"),
    isNull(attachments.thumbnails)
  ) as SQL;
}

/** The rows `ensureThumbnails` would work on, oldest first. */
export async function listThumbnailCandidates(
  db: Db,
  filter: { ids?: readonly string[]; owner?: { ownerType: string; ownerId: string }; ownedOnly?: boolean; limit?: number } = {}
): Promise<ThumbnailCandidate[]> {
  const conditions: (SQL | undefined)[] = [needsThumbnails()];
  if (filter.ids) conditions.push(filter.ids.length ? inArray(attachments.id, [...filter.ids]) : sql`false`);
  if (filter.owner) {
    conditions.push(eq(attachments.ownerType, filter.owner.ownerType), eq(attachments.ownerId, filter.owner.ownerId));
  }
  if (filter.ownedOnly) conditions.push(isNotNull(attachments.ownerId));
  const query = db
    .select({ id: attachments.id, blobPathname: attachments.blobPathname, publicUrl: attachments.publicUrl })
    .from(attachments)
    .where(and(...conditions))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
  const rows = filter.limit ? await query.limit(filter.limit) : await query;
  return rows.filter((row): row is ThumbnailCandidate => typeof row.publicUrl === "string");
}

/**
 * Thumbnails for every matching row that has none — by id (an upload), by
 * owner (a tool after approval). Best effort: failures are counted and
 * logged, never thrown, because the caller's write has already landed.
 */
export async function ensureThumbnails(
  filter: { ids?: readonly string[]; owner?: { ownerType: string; ownerId: string } },
  deps: ThumbnailDeps = {}
): Promise<{ written: number; failed: number }> {
  const io = deps.io === undefined ? createThumbnailIO() : deps.io;
  if (!io) return { written: 0, failed: 0 };
  let written = 0;
  let failed = 0;
  try {
    const db = deps.db ?? (await getDb());
    for (const row of await listThumbnailCandidates(db, filter)) {
      const made = await writeAttachmentThumbnails(row, { ...deps, db, io }).catch((err: unknown) => {
        console.error(`[thumbnails] attachment ${row.id} failed`, err);
        return null;
      });
      if (made) written += 1;
      else failed += 1;
    }
  } catch (err) {
    console.error("[thumbnails] could not list attachments", err);
  }
  return { written, failed };
}
