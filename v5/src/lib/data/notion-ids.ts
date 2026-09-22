import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Postgres row → Notion page id (spec §3.10, §9 Phase 2).
 *
 * **SUPERSEDED — this bridge has no importers as of Phase 3**, and is kept on
 * disk only because deletions are approved separately. Its three call sites
 * (`capabilities/maintenance.ts`, `capabilities/flags.ts` and
 * `api/projects/route.ts`) all write to Postgres now, so there is no longer a
 * Notion page id to translate to. Everything below describes why it existed.
 *
 * Reads moved to Postgres in Phase 2; three writes had not yet (a correction,
 * a maintenance ticket, a project submission). Those still create Notion pages
 * whose `relation` properties address Notion **page** ids, while every id the
 * app now hands around — `tool.id`, `unit.id` — is a Postgres uuid. Notion
 * rejects a relation to a page it cannot find, so without this translation the
 * whole write fails and the student's report is lost.
 *
 * `tools.notion_page_id` and `units.notion_page_id` carry the mapping the
 * import recorded (spec §4), and this module is the only place that reads it.
 * A row with no page id — created after the import, or a demo-seed row —
 * resolves to null, and the caller files the page *without* the relation: a
 * ticket missing its unit link is recoverable by a human, a ticket Notion
 * refused is not (Article 4, fail toward stale rather than toward nothing).
 *
 * This module moves out with the writes in Phase 3.
 */

export interface NotionIdOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** The Notion page the tool was imported from, or null. */
export async function notionPageIdForTool(
  toolId: string,
  options: NotionIdOptions = {}
): Promise<string | null> {
  if (!isUuid(toolId)) return null;

  const db = await resolveDb(options);
  const [row] = await db
    .select({ notionPageId: tools.notionPageId })
    .from(tools)
    .where(eq(tools.id, toolId))
    .limit(1);
  return row?.notionPageId ?? null;
}

/** The Notion page the unit was imported from, or null. */
export async function notionPageIdForUnit(
  unitId: string,
  options: NotionIdOptions = {}
): Promise<string | null> {
  if (!isUuid(unitId)) return null;

  const db = await resolveDb(options);
  const [row] = await db
    .select({ notionPageId: units.notionPageId })
    .from(units)
    .where(eq(units.id, unitId))
    .limit(1);
  return row?.notionPageId ?? null;
}

/**
 * The Notion pages behind a list of tool ids, in the order they were given.
 * Ids that are not uuids, are unknown, or name a tool that never came from
 * Notion are dropped rather than passed through — an unresolvable id would
 * fail the entire write.
 */
export async function notionPageIdsForTools(
  toolIds: string[],
  options: NotionIdOptions = {}
): Promise<string[]> {
  const candidates = toolIds.filter(isUuid);
  if (candidates.length === 0) return [];

  const db = await resolveDb(options);
  const rows = await db
    .select({ id: tools.id, notionPageId: tools.notionPageId })
    .from(tools)
    .where(and(inArray(tools.id, candidates), isNotNull(tools.notionPageId)));

  const byId = new Map(rows.map((row) => [row.id, row.notionPageId]));
  return toolIds.flatMap((id) => {
    const pageId = byId.get(id);
    return pageId ? [pageId] : [];
  });
}

async function resolveDb(options: NotionIdOptions): Promise<Db> {
  return options.db ?? (await getDb());
}
