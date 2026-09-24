import { and, asc, eq, inArray, isNotNull, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { attachments, resources } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { claimAttachments, releaseAttachments } from "./attachments.ts";
import { isManualArchiveKey, manualSourceKey } from "./manual-archives.ts";
import { listManualStates, type ManualState } from "./manual-documents.ts";
import { isUuid } from "./uuid.ts";
import type { Refused } from "./write-result.ts";

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
  /** Public URLs of the resource's attachments, cover first — archived manuals excluded. */
  fileUrls: string[];
  /**
   * The public archived copy of the PDF `url` points at, when the manual
   * archive has made one (`./manual-archives.ts`). Prefer it: it outlives
   * the manufacturer's link.
   */
  archivedUrl: string | null;
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

  const filesByResource = await loadFileUrls(db, rows);

  return rows.map((row) => ({ ...row, ...(filesByResource.get(row.id) ?? NO_FILES) }));
}

/** One resource as the editor lists it — unpublished ones included. */
export interface EditorResource {
  id: string;
  title: string;
  type: string | null;
  url: string | null;
  notes: string | null;
  published: boolean;
  /** Public URLs of the files hanging off it — a manual is usually one PDF. Archived manuals excluded. */
  fileUrls: string[];
  /** The archived copy of the PDF `url` points at, if the manual archive has made one. */
  archivedUrl?: string | null;
  /**
   * Its PDF's processing into text (manual text spec §5): stored, a scan, failed
   * with a reason, or still processing. Absent when the resource holds no PDF.
   */
  manual?: ManualState;
}

/**
 * Every resource of one tool, **including the unpublished ones**.
 *
 * The deliberate opposite of {@link listResourcesForTool}: a resource staff
 * unpublished is one they hid from visitors and from the assistant, and the
 * editor is precisely where they go to look at it again. Ordered by title, like
 * the read above, so the two lists agree about what comes first.
 */
export async function listResourcesForEditor(
  db: Db,
  toolId: string
): Promise<EditorResource[]> {
  if (!isUuid(toolId)) return [];

  const rows = await db
    .select({
      id: resources.id,
      title: resources.title,
      type: resources.type,
      url: resources.url,
      notes: resources.notes,
      published: resources.published,
    })
    .from(resources)
    .where(eq(resources.toolId, toolId))
    .orderBy(asc(resources.title), asc(resources.id));

  if (rows.length === 0) return [];

  const [filesByResource, manuals] = await Promise.all([
    loadFileUrls(db, rows),
    listManualStates(
      db,
      rows.map((row) => row.id)
    ),
  ]);

  return rows.map((row) => {
    const manual = manuals.get(row.id);
    return { ...row, ...(filesByResource.get(row.id) ?? NO_FILES), ...(manual ? { manual } : {}) };
  });
}

// ── Writes (spec §4.6, §5.3(3)) ─────────────────────────────────────
//
// The write lives beside the read, the way `./maintenance.ts` does: this module
// is already this table's data access, and a second module for three statements
// would only give the two halves somewhere to drift apart.

/** The fields the editor offers for a resource. */
export interface ResourceFields {
  title: string;
  /** Free text — no CHECK, deliberately (§4.6). */
  type: string | null;
  url: string | null;
  notes: string | null;
  published: boolean;
}

export type NewResource = Partial<ResourceFields> & Pick<ResourceFields, "title">;
export type ResourcePatch = Partial<ResourceFields>;

/** Which resource, and which tool it has to belong to. */
export interface ResourceScope {
  toolId: string;
  resourceId: string;
}

export type ResourceWriteResult =
  | { ok: true; resourceId: string }
  | Refused<"not_found" | "invalid_field">;

/** The same, plus how many of the submitted files actually attached. */
export type ResourceCreateResult =
  | { ok: true; resourceId: string; filesAttached: number }
  | Refused<"not_found" | "invalid_field">;

/**
 * Add a manual, SOP or link to a tool.
 *
 * A resource may carry a link, an uploaded file, or both: the file is an
 * `attachments` row the upload route already wrote, claimed onto the new
 * resource here so the two land together or not at all. `filesAttached` comes
 * back because a form left open overnight submits ids the daily cron has
 * already swept, and thanking somebody for a manual nobody has is the quiet lie
 * Article 4 forbids.
 */
export async function createResource(
  db: Db,
  toolId: string,
  input: NewResource,
  options: ResourceWriteContext = {}
): Promise<ResourceCreateResult> {
  if (!isUuid(toolId)) return { ok: false, reason: "not_found" };

  const values = toResourceValues(input);
  if (!values || !values.title) return { ok: false, reason: "invalid_field" };

  const [row] = await db
    .insert(resources)
    .values({
      ...values,
      title: values.title,
      toolId,
      createdBy: options.actorUserId ?? null,
      updatedBy: options.actorUserId ?? null,
    })
    .returning({ id: resources.id });

  const filesAttached = await claimAttachments(db, options.fileAttachmentIds ?? [], {
    ownerType: "resource",
    ownerId: row.id,
  });

  return { ok: true, resourceId: row.id, filesAttached };
}

/** Edit one of a tool's resources. Scoped by `tool_id`, like a unit edit. */
export async function updateResource(
  db: Db,
  scope: ResourceScope,
  patch: ResourcePatch,
  options: ResourceWriteContext = {}
): Promise<ResourceWriteResult> {
  if (!isUuid(scope.toolId) || !isUuid(scope.resourceId)) {
    return { ok: false, reason: "not_found" };
  }

  const values = toResourceValues(patch);
  if (!values) return { ok: false, reason: "invalid_field" };
  if (values.title !== undefined && !values.title) return { ok: false, reason: "invalid_field" };

  const rows = await db
    .update(resources)
    .set({ ...values, updatedBy: options.actorUserId ?? null })
    .where(and(eq(resources.id, scope.resourceId), eq(resources.toolId, scope.toolId)))
    .returning({ id: resources.id });

  return rows.length > 0
    ? { ok: true, resourceId: rows[0].id }
    : { ok: false, reason: "not_found" };
}

/**
 * Remove a resource.
 *
 * A resource is a link or a file, not a record anything else refers to, so
 * unlike a tool it is genuinely deleted. Its files are released first: an
 * attachment still owned by a row that no longer exists is invisible to every
 * read *and* to the orphan sweep, which is how a PDF outlives the app that
 * uploaded it.
 */
export async function deleteResource(
  db: Db,
  scope: ResourceScope
): Promise<ResourceWriteResult> {
  if (!isUuid(scope.toolId) || !isUuid(scope.resourceId)) {
    return { ok: false, reason: "not_found" };
  }

  await releaseAttachments(db, { ownerType: "resource", ownerId: scope.resourceId });

  const rows = await db
    .delete(resources)
    .where(and(eq(resources.id, scope.resourceId), eq(resources.toolId, scope.toolId)))
    .returning({ id: resources.id });

  return rows.length > 0
    ? { ok: true, resourceId: rows[0].id }
    : { ok: false, reason: "not_found" };
}

export interface ResourceWriteContext {
  /** Stamped onto `created_by` / `updated_by`; a real `user.id` or null. */
  actorUserId?: string | null;
  /** `attachments.id`s uploaded for this resource — its manual, usually. */
  fileAttachmentIds?: readonly string[];
}

type ResourceValues = Partial<typeof resources.$inferInsert>;

/** Links the editor will render as links. Anything else is somebody's typo. */
const WEB_URL = /^https?:\/\/\S+$/i;

/**
 * The caller's fields as column values, or null when one of them is not worth
 * writing. Only keys the caller sent are included, so editing a title does not
 * blank the link.
 */
function toResourceValues(input: ResourcePatch): ResourceValues | null {
  const values: ResourceValues = {};

  if (input.title !== undefined) values.title = input.title.trim();
  if (input.type !== undefined) values.type = emptyToNull(input.type);
  if (input.notes !== undefined) values.notes = emptyToNull(input.notes);
  if (input.published !== undefined) values.published = input.published;

  if (input.url !== undefined) {
    const url = emptyToNull(input.url);
    // Refused rather than stored: a bare `example.com` renders as a relative
    // link and sends the reader to a page on this site that does not exist.
    if (url !== null && !WEB_URL.test(url)) return null;
    values.url = url;
  }

  return values;
}

function emptyToNull(value: string | null): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed || null;
}

/** A resource's public files, as the two reads above carry them. */
interface ResourceFiles {
  fileUrls: string[];
  archivedUrl: string | null;
}

const NO_FILES: ResourceFiles = { fileUrls: [], archivedUrl: null };

/**
 * Public attachment URLs owned by these resources, grouped by resource id and
 * ordered by `position`. A private file has no URL a visitor could open, and
 * the model is given nothing a visitor could not read.
 *
 * An archived manual is set apart as `archivedUrl` — only the copy of the link
 * the resource carries now; a stale copy of an edited link is dropped — so a
 * caller never counts one manual twice.
 */
async function loadFileUrls(
  db: Db,
  owners: ReadonlyArray<{ id: string; url: string | null }>
): Promise<Map<string, ResourceFiles>> {
  const rows = await db
    .select({ ownerId: attachments.ownerId, publicUrl: attachments.publicUrl, sourceKey: attachments.sourceKey })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, "resource"),
        inArray(
          attachments.ownerId,
          owners.map((owner) => owner.id)
        ),
        eq(attachments.access, "public"),
        isNotNull(attachments.publicUrl)
      )
    )
    .orderBy(asc(attachments.position), asc(attachments.id));

  const currentKey = new Map(
    owners.map((owner) => [owner.id, owner.url ? manualSourceKey(owner.id, owner.url) : null])
  );
  const map = new Map<string, ResourceFiles>();
  for (const row of rows) {
    if (!row.ownerId || !row.publicUrl) continue;
    let entry = map.get(row.ownerId);
    if (!entry) {
      entry = { fileUrls: [], archivedUrl: null };
      map.set(row.ownerId, entry);
    }
    if (isManualArchiveKey(row.sourceKey)) {
      if (row.sourceKey === currentKey.get(row.ownerId)) entry.archivedUrl ??= row.publicUrl;
      continue;
    }
    entry.fileUrls.push(row.publicUrl);
  }
  return map;
}
