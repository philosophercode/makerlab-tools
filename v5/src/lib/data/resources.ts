import { and, asc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { attachments, resources } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Resource reads on Postgres (spec §3.10, §4.6, §4.7).
 *
 * This replaces `fetchAllResources` from `src/lib/notion.ts` behind the chat
 * route's manual attachment: the route picks the focused tool's PDFs and hands
 * their bytes to the model, so it needs each resource's link *and* the files
 * hanging off it.
 *
 * **Unpublished resources are left out.** A resource staff unpublished is one
 * they hid, and the assistant must not read its manual into a conversation.
 * That is the rule the chat route has always applied; note it is deliberately
 * *not* the rule in `./catalog.ts`, where a tool's links are gated by the
 * tool's own visibility so intake-created drafts appear the moment staff
 * publish the tool.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

/** A resource and the public files attached to it. */
export interface ToolResource {
  id: string;
  toolId: string | null;
  title: string;
  type: string | null;
  url: string | null;
  notes: string | null;
  /** Public URLs of the resource's attachments, cover first. */
  fileUrls: string[];
}

export interface ResourceQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** Every published resource in the lab, by title — the order Notion sorted them in. */
export async function listResources(
  options: ResourceQueryOptions = {}
): Promise<ToolResource[]> {
  const db = options.db ?? (await getDb());
  return loadResources(db, eq(resources.published, true));
}

/**
 * One tool's published resources, by title. Empty for a tool with none, and
 * for anything that is not a uuid.
 */
export async function listResourcesForTool(
  toolId: string,
  options: ResourceQueryOptions = {}
): Promise<ToolResource[]> {
  if (!isUuid(toolId)) return [];

  const db = options.db ?? (await getDb());
  return loadResources(
    db,
    and(eq(resources.toolId, toolId), eq(resources.published, true))
  );
}

/**
 * Two statements whatever the number of resources: the rows, then every
 * attachment they own, keyed by resource id.
 */
async function loadResources(db: Db, where: SQL | undefined): Promise<ToolResource[]> {
  const rows = await db
    .select({
      id: resources.id,
      toolId: resources.toolId,
      title: resources.title,
      type: resources.type,
      url: resources.url,
      notes: resources.notes,
    })
    .from(resources)
    .where(where)
    .orderBy(asc(resources.title), asc(resources.id));

  if (rows.length === 0) return [];

  const filesByResource = await loadFileUrls(
    db,
    rows.map((row) => row.id)
  );

  return rows.map((row) => ({ ...row, fileUrls: filesByResource.get(row.id) ?? [] }));
}

/**
 * Public attachment URLs owned by these resources, grouped by resource id and
 * ordered by `position`. A private file has no URL a visitor could open, and
 * the model is given nothing a visitor could not read.
 */
async function loadFileUrls(db: Db, resourceIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ ownerId: attachments.ownerId, publicUrl: attachments.publicUrl })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, "resource"),
        inArray(attachments.ownerId, resourceIds),
        eq(attachments.access, "public"),
        isNotNull(attachments.publicUrl)
      )
    )
    .orderBy(asc(attachments.position), asc(attachments.id));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.ownerId || !row.publicUrl) continue;
    const list = map.get(row.ownerId);
    if (list) list.push(row.publicUrl);
    else map.set(row.ownerId, [row.publicUrl]);
  }
  return map;
}
