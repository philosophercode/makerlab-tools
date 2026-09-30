import { and, asc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../db/client.ts";
import { attachments, categories, locations, resources, tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import type { ToolExportRecord } from "../export/tool-csv.ts";
import { indexAttachments, resourceLinks, type ResourceRow } from "./catalog.ts";
import { isUuid } from "./uuid.ts";

/**
 * The tools CSV's read (`/api/admin/tools/export`, super admins only): every
 * tool — published, draft and archived — or just the ones asked for, with the
 * stored catalogue fields and nothing else.
 *
 * **Public links only.** Photos are the tool's `access = 'public'` attachments
 * with a public URL, in position order (cover first); a private file never
 * reaches the file, whatever it is. Resource links go through the catalogue's
 * own `resourceLinks` over the *published* resources, so the export lists
 * exactly what a visitor sees on the tool page — an archived manual's public
 * copy in place of its link, a hidden SOP left out.
 *
 * Five statements whatever the size of the inventory (tools, units,
 * photos, resources, their files), never one per tool — the discipline
 * `./inventory.ts` follows. Relative `.ts` imports and no `"server-only"`,
 * like every module here, so a script can call it.
 */

/** A category's parent (taxonomy v2): the export's Category when the tool's own is second-level. */
const parentCategory = alias(categories, "parent_category");
/** The tool an accessory belongs to. */
const parentTool = alias(tools, "parent_tool");

export interface ToolExportQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /**
   * Only these tools. Absent means every tool; ids that are not uuids are
   * dropped before they reach the query, and an empty list after that is no
   * tools, never "all".
   */
  ids?: readonly string[];
}

/** Every tool (or the ones asked for), ordered by name like the review table. */
export async function listToolsForExport(options: ToolExportQueryOptions = {}): Promise<ToolExportRecord[]> {
  const db = options.db ?? (await getDb());

  let where: SQL | undefined;
  if (options.ids) {
    const ids = [...new Set(options.ids.filter(isUuid))];
    if (ids.length === 0) return [];
    where = inArray(tools.id, ids);
  }

  const toolRows = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      published: tools.published,
      archivedAt: tools.archivedAt,
      itemKind: tools.itemKind,
      accessoryOf: parentTool.slug,
      // A second-level category sits under a parent; a pre-v2 one under its
      // free-text group; a top-level one with no children is its own heading.
      category: sql<string | null>`coalesce(${parentCategory.name}, ${categories.group}, ${categories.name})`,
      subcategory: sql<string | null>`case when ${parentCategory.name} is not null or ${categories.group} is not null then ${categories.name} end`,
      description: tools.description,
      room: locations.room,
      zone: locations.zone,
      mapTag: locations.mapTag,
      trainingRequired: tools.trainingRequired,
      ppe: tools.ppeRequired,
      useRestrictions: tools.useRestrictions,
      emergencyStop: tools.emergencyStop,
      materials: tools.materials,
      tags: tools.tags,
      notes: tools.notes,
      lastReviewedAt: tools.lastReviewedAt,
      createdAt: tools.createdAt,
      updatedAt: tools.updatedAt,
    })
    .from(tools)
    .leftJoin(categories, eq(tools.categoryId, categories.id))
    .leftJoin(parentCategory, eq(categories.parentId, parentCategory.id))
    .leftJoin(locations, eq(tools.locationId, locations.id))
    .leftJoin(parentTool, eq(tools.parentToolId, parentTool.id))
    .where(where)
    .orderBy(asc(tools.name), asc(tools.id));

  if (toolRows.length === 0) return [];
  const toolIds = toolRows.map((tool) => tool.id);

  const [unitRows, photoRows, resourceRows] = await Promise.all([
    db
      .select({ toolId: units.toolId, label: units.unitLabel })
      .from(units)
      .where(inArray(units.toolId, toolIds))
      .orderBy(asc(units.unitLabel), asc(units.id)),
    db
      .select({ ownerId: attachments.ownerId, publicUrl: attachments.publicUrl })
      .from(attachments)
      .where(
        and(
          eq(attachments.ownerType, "tool"),
          inArray(attachments.ownerId, toolIds),
          eq(attachments.access, "public"),
          isNotNull(attachments.publicUrl)
        )
      )
      .orderBy(asc(attachments.position), asc(attachments.id)),
    db
      .select({
        id: resources.id,
        toolId: resources.toolId,
        title: resources.title,
        type: resources.type,
        url: resources.url,
        notes: resources.notes,
        origin: resources.origin,
      })
      .from(resources)
      .where(and(inArray(resources.toolId, toolIds), eq(resources.published, true)))
      .orderBy(asc(resources.createdAt), asc(resources.title), asc(resources.id)),
  ]);

  // Every file a published resource owns; `resourceLinks` keeps the public ones.
  const resourceFiles = resourceRows.length
    ? indexAttachments(
        await db
          .select({
            ownerType: attachments.ownerType,
            ownerId: attachments.ownerId,
            position: attachments.position,
            access: attachments.access,
            publicUrl: attachments.publicUrl,
            originalFilename: attachments.originalFilename,
            sourceKey: attachments.sourceKey,
          })
          .from(attachments)
          .where(
            and(
              eq(attachments.ownerType, "resource"),
              inArray(
                attachments.ownerId,
                resourceRows.map((resource) => resource.id)
              ),
              isNotNull(attachments.publicUrl)
            )
          )
          .orderBy(asc(attachments.position), asc(attachments.id))
      )
    : new Map();

  const labels = groupBy(unitRows, (row) => row.toolId, (row) => row.label);
  const photos = groupBy(photoRows, (row) => row.ownerId, (row) => row.publicUrl ?? "");
  const resourcesByTool = groupBy(resourceRows, (row) => row.toolId, (row): ResourceRow => row);

  return toolRows.map((tool) => ({
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    officialName: tool.officialName,
    status: tool.archivedAt ? "archived" : tool.published ? "published" : "draft",
    itemKind: tool.itemKind,
    accessoryOf: tool.accessoryOf,
    category: tool.category,
    subcategory: tool.subcategory,
    description: tool.description,
    room: tool.room,
    zone: tool.zone,
    mapTag: tool.mapTag,
    trainingRequired: tool.trainingRequired,
    ppe: tool.ppe,
    useRestrictions: tool.useRestrictions,
    emergencyStop: tool.emergencyStop,
    materials: tool.materials,
    tags: tool.tags,
    notes: tool.notes,
    unitLabels: labels.get(tool.id) ?? [],
    photoUrls: (photos.get(tool.id) ?? []).filter(Boolean),
    resourceUrls: resourceLinks(resourcesByTool.get(tool.id) ?? [], resourceFiles).map((link) => link.href),
    lastReviewedAt: tool.lastReviewedAt,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
  }));
}

function groupBy<T, V>(rows: readonly T[], key: (row: T) => string | null, value: (row: T) => V): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(value(row));
    else map.set(id, [value(row)]);
  }
  return map;
}
