import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { MirrorEntity } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";

/**
 * The rows a push sends, per entity (spec §3.8 "Push" step 2, "What is
 * mirrored"; 2026-09-23 amendment).
 *
 * Each read is one SELECT over the entity's table, LEFT JOINed to this
 * mirror's `mirror_pages`, returning only rows that
 *
 * - changed since the last complete push (`updated_at > since`, or every row
 *   when `since` is null), **and**
 * - are not already mirrored at this revision: no page, a page recorded with
 *   no `source_updated_at` (a row deferred for a missing relation), or
 *   `updated_at > source_updated_at`.
 *
 * The second test is what lets a push cut short by its budget, or re-reading
 * the watermark's five-minute margin, skip everything it already sent.
 *
 * **Timestamps never become a JavaScript `Date`** (read `data/revision.ts`).
 * `revision` is `updated_at::text`, which keeps Postgres' microseconds, and
 * the push writes it back verbatim as `source_updated_at` with
 * `$::timestamptz`. A `Date` would lose the microseconds on Neon, every row
 * would compare newer than its own page, and the mirror would re-push its
 * whole inventory forever. The keyset cursor is the same text.
 *
 * What is selected, and what is not:
 *
 * - **Tools:** every tool, drafts included. An archived tool is selected only
 *   when it already has a page, flagged `archive` — its page is archived, and
 *   a tool that was never mirrored stays unmirrored.
 * - **Projects:** published ones, plus an unpublished one that already has a
 *   page, flagged `archive`.
 * - **Emails are carried** (2026-09-23 amendment): a maintenance log's
 *   reporter name and email and its assignee's name and account email; a
 *   project's author name and account email. They go to Notion and nowhere
 *   else — this module never logs, and the push logs counts only.
 * - **Files:** only attachments with `access = 'public'` and a public URL,
 *   owned by the row itself (a tool, a resource or a project), in `position`
 *   order. Nothing reads `maintenance_log` attachments, which are private
 *   photos, so there is no query here that could select one.
 * - **A relation to an archived tool is dropped** in SQL (`tool_id` comes back
 *   null), so a unit, resource or maintenance log never links to a page the
 *   mirror has archived; a project's tool list leaves archived tools out.
 *
 * Relative imports with `.ts` extensions, no `server-only`: workflow step code
 * loads this module.
 */

// ── Shapes ──────────────────────────────────────────────────────────

/** A public file, as a files property takes it. */
export interface MirrorFile {
  url: string;
  /** The uploaded file's name, when one was recorded. */
  name: string | null;
}

export interface SourceRowBase {
  id: string;
  /** `updated_at::text` — opaque; written back as `source_updated_at` and used as the cursor. */
  revision: string;
  /** `updated_at` as ISO-8601 UTC, for the `Updated` property. */
  updatedAt: string;
  /** The Notion page that already mirrors this row, or null. */
  pageId: string | null;
  /** Archive this row's page instead of updating it (an archived tool, an unpublished project). */
  archive: boolean;
}

export interface CategorySourceRow extends SourceRowBase {
  name: string;
  group: string | null;
}

export interface LocationSourceRow extends SourceRowBase {
  room: string;
  zone: string;
  mapTag: string | null;
}

export interface ToolSourceRow extends SourceRowBase {
  name: string;
  slug: string;
  description: string | null;
  categoryId: string | null;
  locationId: string | null;
  materials: string[];
  ppeRequired: string[];
  tags: string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  emergencyStop: string | null;
  notes: string | null;
  published: boolean;
  archived: boolean;
  /** ISO-8601 UTC, or null. */
  lastReviewedAt: string | null;
  images: MirrorFile[];
}

export interface UnitSourceRow extends SourceRowBase {
  /** Null when the unit has no tool, or its tool is archived. */
  toolId: string | null;
  unitLabel: string;
  serialNumber: string | null;
  assetTag: string | null;
  status: string;
  condition: string | null;
  /** `YYYY-MM-DD`, or null. */
  dateAcquired: string | null;
  notes: string | null;
}

export interface ResourceSourceRow extends SourceRowBase {
  /** Null when the resource has no tool, or its tool is archived. */
  toolId: string | null;
  title: string;
  type: string | null;
  url: string | null;
  published: boolean;
  notes: string | null;
  files: MirrorFile[];
}

export interface MaintenanceSourceRow extends SourceRowBase {
  title: string;
  type: string | null;
  priority: string | null;
  status: string;
  description: string | null;
  resolution: string | null;
  /** Null when the log names no tool, or its tool is archived. */
  toolId: string | null;
  unitId: string | null;
  toolName: string | null;
  unitLabel: string | null;
  reportedByName: string | null;
  reportedByEmail: string | null;
  assignedToName: string | null;
  /** The assignee account's email. */
  assigneeEmail: string | null;
  /** `YYYY-MM-DD`, or null. */
  dateReported: string | null;
  dateResolved: string | null;
}

export interface ProjectSourceRow extends SourceRowBase {
  title: string;
  link: string | null;
  body: string;
  materials: string[];
  /** The project's tools, archived ones left out. */
  toolIds: string[];
  authorName: string | null;
  /** The author account's email. */
  authorEmail: string | null;
  published: boolean;
  /** ISO-8601 UTC, or null. */
  publishedAt: string | null;
  photos: MirrorFile[];
}

export interface SourceRows {
  categories: CategorySourceRow;
  locations: LocationSourceRow;
  tools: ToolSourceRow;
  units: UnitSourceRow;
  resources: ResourceSourceRow;
  maintenance: MaintenanceSourceRow;
  projects: ProjectSourceRow;
}

export type AnySourceRow = SourceRows[MirrorEntity];

/** Where the previous page of rows ended: its last row's `revision` and `id`. */
export interface SourceCursor {
  revision: string;
  id: string;
}

export interface SourceQuery {
  mirrorId: string;
  /** `last_synced_at::text`, or null for every row. */
  since: string | null;
  /** Continue after this row (keyset pagination on `updated_at, id`). */
  after?: SourceCursor | null;
  /** Default 50. */
  limit?: number;
  db?: Db;
}

export const SOURCE_PAGE_SIZE = 50;

// ── SQL pieces ──────────────────────────────────────────────────────

/** A timestamptz as ISO-8601 UTC with milliseconds, computed by Postgres. */
function iso(expression: SQL): SQL {
  return sql`to_char((${expression}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

/** The public files an owner has, as a JSON array of `{ url, name }` in position order. */
function publicFiles(ownerType: "tool" | "resource" | "project"): SQL {
  return sql`coalesce((
    select json_agg(json_build_object('url', a.public_url, 'name', a.original_filename) order by a.position, a.id)
      from attachments a
     where a.owner_type = ${ownerType}
       and a.owner_id = s.id
       and a.access = 'public'
       and a.public_url is not null
  ), '[]'::json)`;
}

/**
 * One page of `entity`'s changed rows. `columns` is the entity's select list
 * (aliased columns of `s`), `joins` any extra joins, and `filter` the
 * entity's own condition. Everything else — the page join, the two change
 * tests, the cursor and the order — is the same for all seven.
 */
async function pageOf<T>(
  entity: MirrorEntity,
  table: string,
  query: SourceQuery,
  parts: { columns: SQL; joins?: SQL; filter?: SQL; archive?: SQL }
): Promise<T[]> {
  const db = query.db ?? (await getDb());
  const limit = Math.max(1, Math.min(500, Math.trunc(query.limit ?? SOURCE_PAGE_SIZE)));
  const conditions: SQL[] = [
    sql`(mp.entity_id is null or mp.source_updated_at is null or s.updated_at > mp.source_updated_at)`,
  ];
  if (query.since !== null) conditions.push(sql`s.updated_at > ${query.since}::timestamptz`);
  if (query.after) {
    conditions.push(sql`(s.updated_at, s.id) > (${query.after.revision}::timestamptz, ${query.after.id}::uuid)`);
  }
  if (parts.filter) conditions.push(parts.filter);

  return rawRows<T>(
    db,
    sql`
      select s.id::text as "id",
             s.updated_at::text as "revision",
             ${iso(sql`s.updated_at`)} as "updatedAt",
             mp.notion_page_id as "pageId",
             ${parts.archive ?? sql`false`} as "archive",
             ${parts.columns}
        from ${sql.raw(`"${table}"`)} s
        left join mirror_pages mp
          on mp.mirror_id = ${query.mirrorId}::uuid
         and mp.entity = ${entity}
         and mp.entity_id = s.id
        ${parts.joins ?? sql``}
       where ${sql.join(conditions, sql` and `)}
       order by s.updated_at, s.id
       limit ${limit}
    `
  );
}

/** A driver may hand json back as text; both drivers in use parse it, but a raw read is cheap to be sure of. */
function json<T>(value: unknown, fallback: T): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
}

function bool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function files(value: unknown): MirrorFile[] {
  return json<{ url?: unknown; name?: unknown }[]>(value, [])
    .filter((file) => typeof file?.url === "string" && file.url !== "")
    .map((file) => ({ url: file.url as string, name: typeof file.name === "string" ? file.name : null }));
}

function strings(value: unknown): string[] {
  return json<unknown[]>(value, []).filter((item): item is string => typeof item === "string");
}

/** The fields every row shares, typed. */
function base(row: Record<string, unknown>): SourceRowBase {
  return {
    id: String(row.id),
    revision: String(row.revision),
    updatedAt: String(row.updatedAt),
    pageId: typeof row.pageId === "string" ? row.pageId : null,
    archive: bool(row.archive),
  };
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// ── Per entity ──────────────────────────────────────────────────────

async function categoryRows(query: SourceQuery): Promise<CategorySourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("categories", "categories", query, {
    columns: sql`s.name as "name", s."group" as "group"`,
  });
  return rows.map((row) => ({ ...base(row), name: String(row.name ?? ""), group: text(row.group) }));
}

async function locationRows(query: SourceQuery): Promise<LocationSourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("locations", "locations", query, {
    columns: sql`s.room as "room", s.zone as "zone", s.map_tag as "mapTag"`,
  });
  return rows.map((row) => ({
    ...base(row),
    room: String(row.room ?? ""),
    zone: String(row.zone ?? ""),
    mapTag: text(row.mapTag),
  }));
}

async function toolRows(query: SourceQuery): Promise<ToolSourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("tools", "tools", query, {
    archive: sql`(s.archived_at is not null)`,
    // An archived tool is only worth selecting when there is a page to archive.
    filter: sql`(s.archived_at is null or mp.entity_id is not null)`,
    columns: sql`
      s.name as "name",
      s.slug as "slug",
      s.description as "description",
      s.category_id::text as "categoryId",
      s.location_id::text as "locationId",
      to_json(s.materials) as "materials",
      to_json(s.ppe_required) as "ppeRequired",
      to_json(s.tags) as "tags",
      s.training_required as "trainingRequired",
      s.use_restrictions as "useRestrictions",
      s.emergency_stop as "emergencyStop",
      s.notes as "notes",
      s.published as "published",
      (s.archived_at is not null) as "archived",
      ${iso(sql`s.last_reviewed_at`)} as "lastReviewedAt",
      ${publicFiles("tool")} as "images"`,
  });
  return rows.map((row) => ({
    ...base(row),
    name: String(row.name ?? ""),
    slug: String(row.slug ?? ""),
    description: text(row.description),
    categoryId: text(row.categoryId),
    locationId: text(row.locationId),
    materials: strings(row.materials),
    ppeRequired: strings(row.ppeRequired),
    tags: strings(row.tags),
    trainingRequired: bool(row.trainingRequired),
    useRestrictions: text(row.useRestrictions),
    emergencyStop: text(row.emergencyStop),
    notes: text(row.notes),
    published: bool(row.published),
    archived: bool(row.archived),
    lastReviewedAt: text(row.lastReviewedAt),
    images: files(row.images),
  }));
}

/** `tool_id`, or null when that tool is archived. */
const LIVE_TOOL_ID = sql`(case when t.archived_at is null then s.tool_id::text else null end)`;
const JOIN_TOOL = sql`left join tools t on t.id = s.tool_id`;

async function unitRows(query: SourceQuery): Promise<UnitSourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("units", "units", query, {
    joins: JOIN_TOOL,
    columns: sql`
      ${LIVE_TOOL_ID} as "toolId",
      s.unit_label as "unitLabel",
      s.serial_number as "serialNumber",
      s.asset_tag as "assetTag",
      s.status as "status",
      s.condition as "condition",
      s.date_acquired::text as "dateAcquired",
      s.notes as "notes"`,
  });
  return rows.map((row) => ({
    ...base(row),
    toolId: text(row.toolId),
    unitLabel: String(row.unitLabel ?? ""),
    serialNumber: text(row.serialNumber),
    assetTag: text(row.assetTag),
    status: String(row.status ?? ""),
    condition: text(row.condition),
    dateAcquired: text(row.dateAcquired),
    notes: text(row.notes),
  }));
}

async function resourceRows(query: SourceQuery): Promise<ResourceSourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("resources", "resources", query, {
    joins: JOIN_TOOL,
    columns: sql`
      ${LIVE_TOOL_ID} as "toolId",
      s.title as "title",
      s.type as "type",
      s.url as "url",
      s.published as "published",
      s.notes as "notes",
      ${publicFiles("resource")} as "files"`,
  });
  return rows.map((row) => ({
    ...base(row),
    toolId: text(row.toolId),
    title: String(row.title ?? ""),
    type: text(row.type),
    url: text(row.url),
    published: bool(row.published),
    notes: text(row.notes),
    files: files(row.files),
  }));
}

async function maintenanceRows(query: SourceQuery): Promise<MaintenanceSourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("maintenance", "maintenance_logs", query, {
    joins: sql`${JOIN_TOOL} left join "user" assignee on assignee.id = s.assigned_to_user_id`,
    columns: sql`
      s.title as "title",
      s.type as "type",
      s.priority as "priority",
      s.status as "status",
      s.description as "description",
      s.resolution as "resolution",
      ${LIVE_TOOL_ID} as "toolId",
      s.unit_id::text as "unitId",
      s.tool_name as "toolName",
      s.unit_label as "unitLabel",
      s.reported_by_name as "reportedByName",
      s.reported_by_email as "reportedByEmail",
      s.assigned_to_name as "assignedToName",
      assignee.email as "assigneeEmail",
      s.date_reported::text as "dateReported",
      s.date_resolved::text as "dateResolved"`,
  });
  return rows.map((row) => ({
    ...base(row),
    title: String(row.title ?? ""),
    type: text(row.type),
    priority: text(row.priority),
    status: String(row.status ?? ""),
    description: text(row.description),
    resolution: text(row.resolution),
    toolId: text(row.toolId),
    unitId: text(row.unitId),
    toolName: text(row.toolName),
    unitLabel: text(row.unitLabel),
    reportedByName: text(row.reportedByName),
    reportedByEmail: text(row.reportedByEmail),
    assignedToName: text(row.assignedToName),
    assigneeEmail: text(row.assigneeEmail),
    dateReported: text(row.dateReported),
    dateResolved: text(row.dateResolved),
  }));
}

async function projectRows(query: SourceQuery): Promise<ProjectSourceRow[]> {
  const rows = await pageOf<Record<string, unknown>>("projects", "projects", query, {
    joins: sql`left join "user" author on author.id = s.author_user_id`,
    archive: sql`(not s.published)`,
    // Unpublished projects are never mirrored — unless one already was, and its page must go.
    filter: sql`(s.published or mp.entity_id is not null)`,
    columns: sql`
      s.title as "title",
      s.link as "link",
      s.body as "body",
      to_json(s.materials) as "materials",
      coalesce((
        select json_agg(pt.tool_id::text order by pt.tool_id)
          from project_tools pt
          join tools pt_tool on pt_tool.id = pt.tool_id
         where pt.project_id = s.id
           and pt_tool.archived_at is null
      ), '[]'::json) as "toolIds",
      s.author_name as "authorName",
      author.email as "authorEmail",
      s.published as "published",
      ${iso(sql`s.published_at`)} as "publishedAt",
      ${publicFiles("project")} as "photos"`,
  });
  return rows.map((row) => ({
    ...base(row),
    title: String(row.title ?? ""),
    link: text(row.link),
    body: String(row.body ?? ""),
    materials: strings(row.materials),
    toolIds: strings(row.toolIds),
    authorName: text(row.authorName),
    authorEmail: text(row.authorEmail),
    published: bool(row.published),
    publishedAt: text(row.publishedAt),
    photos: files(row.photos),
  }));
}

/**
 * One page of `entity`'s rows that need pushing, oldest change first. Pass the
 * last row back as `after` for the next page; an empty result means done.
 */
export async function listSourceRows<E extends MirrorEntity>(entity: E, query: SourceQuery): Promise<SourceRows[E][]> {
  switch (entity) {
    case "categories":
      return (await categoryRows(query)) as SourceRows[E][];
    case "locations":
      return (await locationRows(query)) as SourceRows[E][];
    case "tools":
      return (await toolRows(query)) as SourceRows[E][];
    case "units":
      return (await unitRows(query)) as SourceRows[E][];
    case "resources":
      return (await resourceRows(query)) as SourceRows[E][];
    case "maintenance":
      return (await maintenanceRows(query)) as SourceRows[E][];
    case "projects":
      return (await projectRows(query)) as SourceRows[E][];
    default:
      return [];
  }
}
