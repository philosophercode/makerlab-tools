import { and, asc, count, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import {
  attachments,
  categories,
  locations,
  resources,
  tools,
  units,
} from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { compactNotionId } from "../legacy-id.ts";
import { BUNDLED_TOOL_IMAGES } from "./bundled-tool-images.ts";
import { isManualArchiveKey, manualSourceKey } from "./manual-archives.ts";
import { isUuid } from "./uuid.ts";
import type { MakerLabTool, MakerLabUnit, ToolStatus } from "../../components/catalog-types.ts";

/**
 * The catalogue read path on Postgres (spec §3.10, §4.13).
 *
 * `src/lib/catalog.ts` is the cached wrapper the app calls; this module is the
 * SQL underneath it and the row→view mapping, exported so the derivation rules
 * can be tested without a database. The view models are unchanged — every
 * display string (`"In Use"`, `"Service Soon"`, `"Uncategorized"`) is derived
 * from the stored snake_case vocabulary exactly as `catalog.ts` derived it from
 * Notion's Title-case select options.
 *
 * A catalogue read is four statements whatever the size of the catalogue —
 * tools with their category and location, then units, resources and
 * attachments in bulk — never one per tool.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads this module under plain Node.
 */

/** A `tools` row joined to its category and location. */
export interface ToolRow {
  id: string;
  slug: string;
  /** The display name. */
  name: string;
  /** The official name (tool display names spec); absent on fixtures from before it. */
  officialName?: string | null;
  description: string | null;
  materials: string[];
  ppeRequired: string[];
  tags: string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  emergencyStop: string | null;
  notes: string | null;
  starterQuestions: string[];
  categoryName: string | null;
  categoryGroup: string | null;
  room: string | null;
  zone: string | null;
  mapTag: string | null;
  /** When the tool row was created — the gallery's "Recently added" sort. Absent on older fixtures. */
  createdAt?: Date | string | null;
}

/** A `units` row belonging to one tool. */
export interface UnitRow {
  id: string;
  toolId: string | null;
  unitLabel: string;
  serialNumber: string | null;
  assetTag: string | null;
  status: string;
  condition: string | null;
  dateAcquired: string | null;
}

/** A `resources` row belonging to one tool. */
export interface ResourceRow {
  id: string;
  toolId: string | null;
  title: string;
  type: string | null;
  url: string | null;
  notes: string | null;
  /** `lab_document` for the lab's own material an import carried (bulk intake spec §3.4). */
  origin?: string | null;
}

/** An `attachments` row: a file in Blob and the row it hangs off. */
export interface AttachmentRow {
  ownerType: string | null;
  ownerId: string | null;
  position: number;
  access: string;
  publicUrl: string | null;
  originalFilename: string | null;
  /** Set on an archived manual (`manual:<resource id>:<url>`); see `./manual-archives.ts`. */
  sourceKey?: string | null;
}

/** Attachments grouped by `<owner type>:<owner id>`, each list in position order. */
export type AttachmentIndex = Map<string, AttachmentRow[]>;

export interface CatalogQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** Include unpublished tools. Off by default: the catalogue is published-only. */
  includeDrafts?: boolean;
  /**
   * Include archived tools too. Only the MCP catalogue tools ask, for a caller
   * holding `tools.edit`, and mark each one (MCP access spec §3.2).
   */
  includeArchived?: boolean;
}

/** Published, still a draft, or archived — the same rule `inventory.ts` uses. */
export type CatalogToolState = "published" | "draft" | "archived";

/** Every tool's state by id, drafts and archived rows included. One statement. */
export async function listToolStates(
  options: Pick<CatalogQueryOptions, "db"> = {}
): Promise<Map<string, CatalogToolState>> {
  const db = await resolveDb(options);
  const rows = await db
    .select({ id: tools.id, published: tools.published, archived: isNotNull(tools.archivedAt) })
    .from(tools);
  return new Map(
    rows.map((row) => [row.id, row.archived ? "archived" : row.published ? "published" : "draft"] as const)
  );
}

// ── Queries ─────────────────────────────────────────────────────────

/** Every published, non-archived tool, ordered by name. */
export async function listCatalogTools(
  options: CatalogQueryOptions = {}
): Promise<MakerLabTool[]> {
  const db = await resolveDb(options);
  return loadTools(db, and(...visibility(options)));
}

/** One tool by slug, or null. Published only unless `includeDrafts` is passed. */
export async function findToolBySlug(
  slug: string,
  options: CatalogQueryOptions = {}
): Promise<MakerLabTool | null> {
  const db = await resolveDb(options);
  const [tool] = await loadTools(db, and(eq(tools.slug, slug), ...visibility(options)));
  return tool ?? null;
}

/**
 * One tool by slug or by Postgres uuid, or null. Capabilities hand `tool.id`
 * straight back (`get_tool_details`), and the tool route passes a slug, so both
 * resolve here in a single statement. A value that is neither a uuid nor a
 * known slug returns null rather than reaching Postgres as a bad uuid cast.
 */
export async function findToolByIdOrSlug(
  idOrSlug: string,
  options: CatalogQueryOptions = {}
): Promise<MakerLabTool | null> {
  const db = await resolveDb(options);
  const match = isUuid(idOrSlug)
    ? or(eq(tools.slug, idOrSlug), eq(tools.id, idOrSlug))
    : eq(tools.slug, idOrSlug);
  const [tool] = await loadTools(db, and(match, ...visibility(options)));
  return tool ?? null;
}

/**
 * The slug behind a legacy `/tools/<notion-page-id>` link, or null (spec
 * Goal 2). Dashes and case are normalised on both sides, because the id in a
 * printed QR label is undashed and the stored one is not.
 *
 * Unfiltered by `published` and `archived_at` on purpose: an old link should
 * land on the tool's current page and let that page decide what to show,
 * rather than silently 404 at the redirect.
 */
export async function findToolByNotionPageId(
  id: string,
  options: CatalogQueryOptions = {}
): Promise<{ slug: string } | null> {
  const compact = compactNotionId(id);
  if (!compact) return null;

  const db = await resolveDb(options);
  const [row] = await db
    .select({ slug: tools.slug })
    .from(tools)
    .where(sql`lower(replace(${tools.notionPageId}, '-', '')) = ${compact}`)
    .limit(1);
  return row ?? null;
}

/** How many tools the catalogue shows — `getCatalogStats().toolsInInventory`. */
export async function countPublishedTools(options: CatalogQueryOptions = {}): Promise<number> {
  const db = await resolveDb(options);
  const [row] = await db
    .select({ value: count() })
    .from(tools)
    .where(and(...visibility(options)));
  return row?.value ?? 0;
}

async function resolveDb(options: CatalogQueryOptions): Promise<Db> {
  return options.db ?? (await getDb());
}

/** Archived tools are never shown; drafts only when the caller asks. */
function visibility(options: CatalogQueryOptions): SQL[] {
  const clauses: SQL[] = [];
  if (!options.includeArchived) clauses.push(isNull(tools.archivedAt));
  if (!options.includeDrafts) clauses.push(eq(tools.published, true));
  return clauses;
}

/**
 * Tools matching `where`, with everything they display. Four statements: the
 * tools themselves, their units, their resources, and the attachments owned by
 * either — so the cost of a catalogue page does not grow with the tool count.
 */
async function loadTools(db: Db, where: SQL | undefined): Promise<MakerLabTool[]> {
  const toolRows: ToolRow[] = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      description: tools.description,
      materials: tools.materials,
      ppeRequired: tools.ppeRequired,
      tags: tools.tags,
      trainingRequired: tools.trainingRequired,
      useRestrictions: tools.useRestrictions,
      emergencyStop: tools.emergencyStop,
      notes: tools.notes,
      starterQuestions: tools.starterQuestions,
      categoryName: categories.name,
      categoryGroup: categories.group,
      room: locations.room,
      zone: locations.zone,
      mapTag: locations.mapTag,
      createdAt: tools.createdAt,
    })
    .from(tools)
    .leftJoin(categories, eq(tools.categoryId, categories.id))
    .leftJoin(locations, eq(tools.locationId, locations.id))
    .where(where)
    .orderBy(asc(tools.name));

  if (toolRows.length === 0) return [];
  const toolIds = toolRows.map((tool) => tool.id);

  const unitRows: UnitRow[] = await db
    .select({
      id: units.id,
      toolId: units.toolId,
      unitLabel: units.unitLabel,
      serialNumber: units.serialNumber,
      assetTag: units.assetTag,
      status: units.status,
      condition: units.condition,
      dateAcquired: units.dateAcquired,
    })
    .from(units)
    .where(inArray(units.toolId, toolIds))
    .orderBy(asc(units.unitLabel), asc(units.id));

  // Filtered by `resources.published`, and it has to be: Phase 5 gave the
  // editor a **Hide** control on every resource (§5.3(3)), and an internal SOP
  // somebody deliberately hid staying on the tool's public page would make that
  // control a lie — the worse kind, because the panel tags the row "Hidden"
  // while an anonymous visitor reads it. It also matches
  // `listResourcesForTool`, the read the assistant uses, so the two agree about
  // what "hidden" means.
  //
  // This used to be unfiltered because resources once arrived as drafts and
  // stayed invisible after staff published the tool. They do not any more:
  // `resources.published` defaults to **true** (§4.6), so a hidden resource is
  // always one a person chose to hide.
  //
  // What it does *not* do is unpublish the file itself: a resource's PDF is a
  // public blob at a random pathname and stays fetchable by anyone holding the
  // URL. Hiding removes the link, not the document.
  const resourceRows: ResourceRow[] = await db
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
    .orderBy(asc(resources.createdAt), asc(resources.title), asc(resources.id));

  const files = indexAttachments(
    await selectAttachments(
      db,
      toolIds,
      resourceRows.map((resource) => resource.id)
    )
  );
  const unitsByTool = groupByTool(unitRows);
  const resourcesByTool = groupByTool(resourceRows);

  return toolRows.map((tool) =>
    toMakerLabTool(tool, unitsByTool.get(tool.id) ?? [], resourcesByTool.get(tool.id) ?? [], files)
  );
}

/** Every attachment owned by one of these tools or resources, in position order. */
async function selectAttachments(
  db: Db,
  toolIds: string[],
  resourceIds: string[]
): Promise<AttachmentRow[]> {
  const ownedByTool = toolIds.length
    ? and(eq(attachments.ownerType, "tool"), inArray(attachments.ownerId, toolIds))
    : undefined;
  const ownedByResource = resourceIds.length
    ? and(eq(attachments.ownerType, "resource"), inArray(attachments.ownerId, resourceIds))
    : undefined;
  if (!ownedByTool && !ownedByResource) return [];

  return db
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
    .where(and(or(ownedByTool, ownedByResource), isNotNull(attachments.publicUrl)))
    .orderBy(asc(attachments.position), asc(attachments.id));
}

function groupByTool<T extends { toolId: string | null }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    if (!row.toolId) continue;
    const list = map.get(row.toolId);
    if (list) list.push(row);
    else map.set(row.toolId, [row]);
  }
  return map;
}

// ── Row → view model ────────────────────────────────────────────────

export function indexAttachments(rows: AttachmentRow[]): AttachmentIndex {
  const index: AttachmentIndex = new Map();
  for (const row of rows) {
    if (!row.ownerType || !row.ownerId) continue;
    const key = attachmentKey(row.ownerType, row.ownerId);
    const list = index.get(key);
    if (list) list.push(row);
    else index.set(key, [row]);
  }
  // Sorted here rather than trusted from the query, so the first attachment is
  // the lowest-position one however the rows arrived.
  for (const list of index.values()) list.sort((a, b) => a.position - b.position);
  return index;
}

export function attachmentsFor(
  index: AttachmentIndex,
  ownerType: string,
  ownerId: string
): AttachmentRow[] {
  return index.get(attachmentKey(ownerType, ownerId)) ?? [];
}

function attachmentKey(ownerType: string, ownerId: string): string {
  return `${ownerType}:${ownerId}`;
}

export function toMakerLabTool(
  tool: ToolRow,
  unitRows: UnitRow[],
  resourceRows: ResourceRow[] = [],
  files: AttachmentIndex = new Map()
): MakerLabTool {
  const mappedUnits = unitRows.map((unit) => toMakerLabUnit(unit, tool));
  const status = deriveStatus(tool, mappedUnits);

  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    officialName: tool.officialName ?? null,
    category: tool.categoryGroup || "Uncategorized",
    categorySub: tool.categoryName || "Other",
    location: tool.room || "Unknown",
    zone: tool.zone || "Unknown",
    trainingLevel: deriveTrainingLevel(tool),
    trainingLabel: deriveTrainingLabel(tool),
    status,
    shortDescription: tool.description || "Catalog record pending description.",
    description: tool.description || "This tool record is available in the MakerLab catalog.",
    imageSrc: toolImageSrc(tool, attachmentsFor(files, "tool", tool.id)),
    ppe: tool.ppeRequired.length ? tool.ppeRequired : ["Check posted lab guidance"],
    materials: tool.materials,
    tags: tool.tags,
    emergencyStop: tool.emergencyStop,
    useRestrictions: tool.useRestrictions,
    mapId: tool.mapTag,
    notes: tool.notes,
    links: resourceLinks(resourceRows, files),
    units: mappedUnits,
    starterQuestions: tool.starterQuestions ?? [],
    addedAt: tool.createdAt ? new Date(tool.createdAt).toISOString() : null,
  };
}

/**
 * The tool's first public photo in Blob, or the bundled photo named after it.
 * The bundled photos carry the imported (long) names, which the display-name
 * backfill moves to `official_name` — so whichever of the two names has a
 * bundled photo wins, the display name first (tool display names spec §5.8).
 */
export function toolImageSrc(tool: Pick<ToolRow, "name" | "officialName">, files: AttachmentRow[]): string {
  const image = files.find((file) => file.access === "public" && file.publicUrl);
  if (image?.publicUrl) return image.publicUrl;
  const bundled = [tool.name, tool.officialName ?? ""].find((name) => name.trim() && BUNDLED_TOOL_IMAGES.has(bundledFileName(name)));
  return localToolImage(bundled ?? tool.name);
}

function bundledFileName(name: string): string {
  return name.replace(/\//g, "_");
}

/**
 * A link per resource url, plus one per file the resource owns.
 *
 * **An archived manual replaces its link rather than joining it.** When the
 * resource owns a public copy of the PDF its `url` points at (the manual
 * archive, `./manual-archives.ts`), the one link goes to the copy — it
 * survives the manufacturer moving the file — and the manufacturer's URL rides
 * along as `sourceHref`. The copy is never listed as a second file link, and a
 * copy of a link the resource no longer carries (stale) is not listed at all.
 */
export function resourceLinks(
  resourceRows: ResourceRow[],
  files: AttachmentIndex = new Map()
): MakerLabTool["links"] {
  const links = resourceRows.flatMap((resource) => {
    const base = {
      kind: resource.type || "Resource",
      description: resource.notes || undefined,
      // The lab's own document (bulk intake spec §3.4): labelled so, listed
      // first, and never opened by the assistant.
      ...(resource.origin === "lab_document" ? { labDocument: true as const } : {}),
    };
    const owned = attachmentsFor(files, "resource", resource.id);
    const archive = resource.url ? archivedCopy(owned, resource.id, resource.url) : undefined;
    const urlLinks = resource.url
      ? [
          {
            label: resource.title || resource.type || "Resource",
            href: archive?.publicUrl || resource.url,
            ...(archive ? { sourceHref: resource.url } : {}),
            ...base,
          },
        ]
      : [];
    // A private file has no public URL to link to, and would not be one a
    // visitor is allowed to open even if it did.
    const fileLinks = owned.flatMap((file) =>
      file.access === "public" && file.publicUrl && !isManualArchiveKey(file.sourceKey)
        ? [
            {
              label: resource.title || file.originalFilename || resource.type || "Resource",
              href: file.publicUrl,
              ...base,
            },
          ]
        : []
    );

    return [...urlLinks, ...fileLinks];
  });
  // Lab documents sit above the manufacturer's links (§3.4); order otherwise kept.
  return [...links.filter((link) => link.labDocument), ...links.filter((link) => !link.labDocument)];
}

/** The resource's public archive of exactly this link, if it has one. */
function archivedCopy(owned: AttachmentRow[], resourceId: string, url: string): AttachmentRow | undefined {
  const key = manualSourceKey(resourceId, url);
  return owned.find((file) => file.sourceKey === key && file.access === "public" && Boolean(file.publicUrl));
}

export function toMakerLabUnit(
  unit: UnitRow,
  tool: Pick<ToolRow, "name" | "room" | "zone">
): MakerLabUnit {
  return {
    id: unit.id,
    name: unit.unitLabel || `${tool.name} // Unit`,
    serial: unit.serialNumber || unit.assetTag || "Unlisted",
    status: toToolStatus(unit.status, false),
    condition: toCondition(unit.condition, unit.status),
    location: tool.zone || tool.room || "Unknown",
    dateAcquired: unit.dateAcquired || null,
  };
}

export function deriveStatus(
  tool: Pick<ToolRow, "trainingRequired">,
  units: MakerLabUnit[]
): ToolStatus {
  if (units.some((unit) => unit.status === "In Use")) return "In Use";
  if (units.length > 0 && units.every((unit) => unit.status === "Offline")) return "Offline";
  return toToolStatus(undefined, tool.trainingRequired);
}

export function toToolStatus(
  status: string | null | undefined,
  trainingRequired: boolean
): ToolStatus {
  if (status === "in_use") return "In Use";
  if (status === "under_maintenance" || status === "out_of_service" || status === "retired") {
    return "Offline";
  }
  if (trainingRequired) return "Training Required";
  return "Available";
}

export function toCondition(
  condition: string | null | undefined,
  status: string | null | undefined
): MakerLabUnit["condition"] {
  if (status === "out_of_service" || status === "retired") return "Offline";
  if (condition === "needs_repair" || status === "under_maintenance") return "Service Soon";
  if (condition === "excellent") return "Excellent";
  // `fair`, `new` and an unknown condition all read as Good, as they did when
  // the same four display values came from Notion's select options.
  return "Good";
}

export function deriveTrainingLevel(
  tool: Pick<ToolRow, "useRestrictions" | "tags" | "trainingRequired">
): MakerLabTool["trainingLevel"] {
  const restrictionText = `${tool.useRestrictions || ""} ${tool.tags.join(" ")}`.toLowerCase();
  if (restrictionText.includes("advanced") || restrictionText.includes("authorized")) {
    return "Advanced";
  }
  if (tool.trainingRequired) return "Intermediate";
  return "Beginner";
}

export function deriveTrainingLabel(
  tool: Pick<ToolRow, "useRestrictions" | "tags" | "trainingRequired">
): string {
  if (!tool.trainingRequired) return "Beginner orientation";
  if (tool.useRestrictions) return tool.useRestrictions;
  return `${deriveTrainingLevel(tool)} checkout required`;
}

export function localToolImage(name: string): string {
  return `/tool-images/${encodeURIComponent(bundledFileName(name))}.png`;
}
