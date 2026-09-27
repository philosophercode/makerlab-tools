import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import { mirrorPages } from "../db/schema/mirror.ts";
import { MIRROR_ENTITY, isOneOf, type MirrorEntity } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * `mirror_pages` — which Notion page mirrors which app row, per mirror (spec
 * §3.8 "Push" step 3, §4.12).
 *
 * The push looks a batch of rows up here, updates the pages it finds and
 * creates the rest, recording each new page id as it goes, so a push cut short
 * by its budget never creates the same page twice.
 *
 * `source_updated_at` is written from the text the push selected
 * (`updated_at::text`) as `$::timestamptz`, never from a JavaScript `Date`, so
 * it keeps Postgres' microseconds (see `revision.ts`).
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `server-only`:
 * workflow step code loads this module.
 */

export interface MirrorPageOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** The Postgres table each entity mirrors. `maintenance` is `maintenance_logs`. */
export const MIRROR_SOURCE_TABLE: Readonly<Record<MirrorEntity, string>> = {
  categories: "categories",
  locations: "locations",
  tools: "tools",
  units: "units",
  resources: "resources",
  maintenance: "maintenance_logs",
  projects: "projects",
};

async function handle(options: MirrorPageOptions): Promise<Db> {
  return options.db ?? (await getDb());
}

/** `entityId → notion_page_id` for the rows of `entityIds` that already have a page. */
export async function getMirrorPageIds(
  mirrorId: string,
  entity: MirrorEntity,
  entityIds: string[],
  options: MirrorPageOptions = {}
): Promise<Map<string, string>> {
  const ids = [...new Set(entityIds.filter(isUuid))];
  if (!isUuid(mirrorId) || ids.length === 0 || !isOneOf(MIRROR_ENTITY, entity)) return new Map();
  const db = await handle(options);
  const rows = await db
    .select({ entityId: mirrorPages.entityId, notionPageId: mirrorPages.notionPageId })
    .from(mirrorPages)
    .where(and(eq(mirrorPages.mirrorId, mirrorId), eq(mirrorPages.entity, entity), inArray(mirrorPages.entityId, ids)));
  return new Map(rows.map((row) => [row.entityId, row.notionPageId]));
}

/**
 * Record (or re-record) the page that mirrors one row, stamping `pushed_at = now()`.
 *
 * With `generation` (the push's claim), the row is written only while the
 * mirror is still at that `mapping_generation`: a push still running after
 * Create databases or Save mapping changed the mapping must not record pages
 * in the old databases over the reset — the next push would take them as
 * mirrored and never write the new ones. True when the row was written.
 */
export async function upsertMirrorPage(
  input: {
    mirrorId: string;
    entity: MirrorEntity;
    entityId: string;
    notionPageId: string;
    /** The source row's `updated_at::text`, straight from the push's SELECT. */
    sourceUpdatedAt: string | null;
    /** The push's claimed `mapping_generation`; omitted, the write is unconditional. */
    generation?: number;
  },
  options: MirrorPageOptions = {}
): Promise<boolean> {
  const db = await handle(options);
  const sourceUpdatedAt = input.sourceUpdatedAt === null ? null : sql`${input.sourceUpdatedAt}::timestamptz`;
  if (input.generation !== undefined) {
    const rows = await rawRows<{ entity_id: string }>(
      db,
      sql`
        insert into mirror_pages (mirror_id, entity, entity_id, notion_page_id, pushed_at, source_updated_at)
        select ${input.mirrorId}::uuid, ${input.entity}, ${input.entityId}::uuid, ${input.notionPageId}, now(), ${sourceUpdatedAt}
         where exists (
           select 1 from notion_mirrors n
            where n.id = ${input.mirrorId}::uuid and n.mapping_generation = ${input.generation}
         )
        on conflict (mirror_id, entity, entity_id) do update
           set notion_page_id = excluded.notion_page_id,
               pushed_at = excluded.pushed_at,
               source_updated_at = excluded.source_updated_at
        returning entity_id
      `
    );
    return rows.length > 0;
  }
  await db
    .insert(mirrorPages)
    .values({
      mirrorId: input.mirrorId,
      entity: input.entity,
      entityId: input.entityId,
      notionPageId: input.notionPageId,
      pushedAt: sql`now()`,
      sourceUpdatedAt,
    })
    .onConflictDoUpdate({
      target: [mirrorPages.mirrorId, mirrorPages.entity, mirrorPages.entityId],
      set: { notionPageId: input.notionPageId, pushedAt: sql`now()`, sourceUpdatedAt },
    });
  return true;
}

/** Forget one row's page — after archiving it, or when Notion says it is gone. */
export async function deleteMirrorPage(
  mirrorId: string,
  entity: MirrorEntity,
  entityId: string,
  options: MirrorPageOptions = {}
): Promise<void> {
  if (!isUuid(mirrorId) || !isUuid(entityId)) return;
  const db = await handle(options);
  await db
    .delete(mirrorPages)
    .where(and(eq(mirrorPages.mirrorId, mirrorId), eq(mirrorPages.entity, entity), eq(mirrorPages.entityId, entityId)));
}

/**
 * Pages whose source row no longer exists — an anti-join from `mirror_pages`
 * to the entity's table — oldest push first, at most `limit` (100 by default).
 * The push archives these pages and then forgets them.
 *
 * `db` is accepted in the third argument as well as the fourth, so both
 * `(id, entity, { limit }, { db })` and `(id, entity, { limit, db })` work.
 */
export async function listOrphanedMirrorPages(
  mirrorId: string,
  entity: MirrorEntity,
  query: { limit?: number; db?: Db } = {},
  options: MirrorPageOptions = {}
): Promise<{ entityId: string; notionPageId: string }[]> {
  if (!isUuid(mirrorId) || !isOneOf(MIRROR_ENTITY, entity)) return [];
  const limit = Math.max(1, Math.min(1000, Math.trunc(query.limit ?? 100)));
  const db = options.db ?? query.db ?? (await getDb());
  const table = sql.raw(`"${MIRROR_SOURCE_TABLE[entity]}"`);
  const rows = await rawRows<{ entity_id: string; notion_page_id: string }>(
    db,
    sql`
      select mp.entity_id, mp.notion_page_id
        from mirror_pages mp
       where mp.mirror_id = ${mirrorId}
         and mp.entity = ${entity}
         and not exists (select 1 from ${table} s where s.id = mp.entity_id)
       order by mp.pushed_at, mp.entity_id
       limit ${limit}
    `
  );
  return rows.map((row) => ({ entityId: row.entity_id, notionPageId: row.notion_page_id }));
}
