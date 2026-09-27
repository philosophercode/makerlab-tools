import { and, eq, like, ne, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import { attachments } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Archived manuals — a resource's PDF, copied into Blob so the tool keeps its
 * manual after the manufacturer moves or deletes it.
 *
 * **No table of its own.** The copy is an ordinary `attachments` row owned by
 * the resource (`owner_type = 'resource'`), public, `application/pdf`, and
 * recognised by its `source_key`: `manual:<resource id>:<source url>`. The
 * resource keeps its own `url` — the manufacturer's link — so the key says
 * *which* link the copy was made from, and a copy of a link the resource no
 * longer carries is stale rather than current. The resource id is in the key
 * because `source_key` is globally unique and two tools can share a
 * manufacturer's PDF.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`: the archive
 * step runs under plain Node in a workflow.
 */

/** Every archive key starts with this. */
export const MANUAL_SOURCE_PREFIX = "manual:";

/**
 * Longer URLs are not archived: the key would outgrow what a btree unique
 * index accepts, and a 2 000-character manual link is not one worth guessing
 * about.
 */
export const MAX_ARCHIVABLE_URL_LENGTH = 2000;

/** The `source_key` of this resource's archived copy of `url`. */
export function manualSourceKey(resourceId: string, url: string): string {
  return `${MANUAL_SOURCE_PREFIX}${resourceId}:${url}`;
}

/** True for any archive key, current or stale. */
export function isManualArchiveKey(sourceKey: string | null | undefined): boolean {
  return typeof sourceKey === "string" && sourceKey.startsWith(MANUAL_SOURCE_PREFIX);
}

/** A PDF the resource already holds, as the archiver needs to see it. */
export interface ResourcePdf {
  id: string;
  sourceKey: string | null;
}

/** Every `application/pdf` attachment this resource owns. */
export async function listResourcePdfs(db: Db, resourceId: string): Promise<ResourcePdf[]> {
  if (!isUuid(resourceId)) return [];
  return db
    .select({ id: attachments.id, sourceKey: attachments.sourceKey })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, "resource"),
        eq(attachments.ownerId, resourceId),
        eq(attachments.contentType, "application/pdf")
      )
    );
}

/**
 * Take this resource's archives of *other* links off it, so the daily sweep
 * collects them (`releaseAttachments`' rule: never delete bytes from inside a
 * write). Called in the transaction that records the new copy, after the
 * resource's link was edited.
 */
export async function releaseStaleManualArchives(db: Db, resourceId: string, currentKey: string): Promise<number> {
  if (!isUuid(resourceId)) return 0;
  const rows = await db
    .update(attachments)
    .set({ ownerType: null, ownerId: null, position: 0 })
    .where(
      and(
        eq(attachments.ownerType, "resource"),
        eq(attachments.ownerId, resourceId),
        like(attachments.sourceKey, `${MANUAL_SOURCE_PREFIX}${resourceId}:%`),
        ne(attachments.sourceKey, currentKey)
      )
    )
    .returning({ id: attachments.id });
  return rows.length;
}

export interface ManualsDueOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** How many to return. */
  limit: number;
  /**
   * Which night this is, as a day count. The window rotates by it — see
   * {@link listManualsDueForArchive}.
   */
  day: number;
}

/**
 * Manual resources with a link and no PDF for it yet — the daily cron's
 * backfill (and backstop for a start that never happened).
 *
 * Due means: `type` is Manual (any case), `url` is an http(s) link short
 * enough to key, and the resource owns no `application/pdf` attachment that
 * is either its archive of *this* link or a file somebody uploaded or the
 * import copied. A stale archive (of a link since edited) does not count.
 *
 * **Oldest first, in a window that moves each night.** Nothing records that
 * an archive was refused — a manual whose link is an HTML product page stays
 * due forever — so "the ten oldest" would be the same ten refusals every
 * night and the backfill would never reach the eleventh. Instead the window
 * starts at `(day × limit) mod due` in oldest-first order and wraps, so every
 * due manual is tried within `ceil(due / limit)` nights whatever fails.
 */
export async function listManualsDueForArchive(options: ManualsDueOptions): Promise<{ due: number; ids: string[] }> {
  const db = options.db ?? (await getDb());
  const limit = Math.max(0, Math.floor(options.limit));

  const where = sql`
    lower(r.type) = 'manual'
    and r.url ~* '^https?://'
    and length(r.url) <= ${MAX_ARCHIVABLE_URL_LENGTH}
    and not exists (
      select 1 from attachments a
       where a.owner_type = 'resource'
         and a.owner_id = r.id
         and a.content_type = 'application/pdf'
         and (a.source_key is null
              or a.source_key not like ${`${MANUAL_SOURCE_PREFIX}%`}
              or a.source_key = ${MANUAL_SOURCE_PREFIX} || r.id::text || ':' || r.url)
    )`;

  const [{ count }] = await rawRows<{ count: number | string }>(
    db,
    sql`select count(*)::int as count from resources r where ${where}`
  );
  const due = Number(count);
  if (due === 0 || limit === 0) return { due, ids: [] };

  const start = ((Math.floor(options.day) * limit) % due + due) % due;
  const page = (offset: number, take: number) =>
    rawRows<{ id: string }>(
      db,
      sql`select r.id from resources r where ${where}
           order by r.created_at asc, r.id asc
           offset ${offset} limit ${take}`
    );

  const first = await page(start, limit);
  const rest = first.length < limit && start > 0 ? await page(0, Math.min(limit - first.length, start)) : [];
  return { due, ids: [...first, ...rest].map((row) => row.id) };
}
