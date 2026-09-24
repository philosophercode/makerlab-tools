import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { attachments, projectTools, projects, tools } from "../db/schema/index.ts";
import { slugify, uniqueSlug } from "../db/slug.ts";
import type { Db } from "../db/types.ts";
import { claimAttachments } from "./attachments.ts";
import { isUuid } from "./uuid.ts";
import type { MakerLabProject, ProjectToolRef } from "../../components/catalog-types.ts";

/**
 * Postgres reads for published projects (data platform design spec 2026-09-14
 * §3.10, §4.10, §4.13), and since Phase 3 the submission write. This is the
 * query module `src/lib/projects.ts` wraps in `"use cache"`; nothing here is
 * cached itself, so every export is a plain round trip and safe to call as
 * often as the caller needs a fresh answer.
 *
 * Imports are relative with `.ts` extensions and skip the `@/` alias, like
 * everything under `src/lib/db/` and `src/lib/import/`: scripts load these
 * modules under plain Node type-stripping, which cannot resolve either.
 *
 * A project's photos and tool refs are joined in eagerly rather than resolved
 * lazily per view, because both list views (the gallery, "Built with this")
 * need the whole set at once and Article 4 prefers one round trip of joins
 * over N+1 queries.
 */

type ProjectRow = typeof projects.$inferSelect;

/** Every published project, newest first (spec §4.10). */
export async function listPublishedProjects(): Promise<MakerLabProject[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.published, true))
    .orderBy(desc(projects.createdAt));
  return hydrateProjects(db, rows);
}

/**
 * A published project by its uuid id or its slug. Null for an unknown id, a
 * slug that matches nothing, or a real row that is not published — a draft is
 * never reachable by guessing its id.
 */
export async function findPublishedProject(idOrSlug: string): Promise<MakerLabProject | null> {
  const db = await getDb();
  const match = isUuid(idOrSlug) ? eq(projects.id, idOrSlug) : eq(projects.slug, idOrSlug);
  const rows = await db
    .select()
    .from(projects)
    .where(and(match, eq(projects.published, true)))
    .limit(1);
  const [hydrated] = await hydrateProjects(db, rows);
  return hydrated ?? null;
}

/** Published projects built with a given tool — the tool page's "Built with this" section. */
export async function listPublishedProjectsForTool(toolId: string): Promise<MakerLabProject[]> {
  if (!isUuid(toolId)) return [];

  const db = await getDb();
  const rows = await db
    .select({ project: projects })
    .from(projects)
    .innerJoin(projectTools, eq(projectTools.projectId, projects.id))
    .where(and(eq(projectTools.toolId, toolId), eq(projects.published, true)))
    .orderBy(desc(projects.createdAt));
  return hydrateProjects(
    db,
    rows.map((row) => row.project)
  );
}

// ── Submitting a project (spec §4.10, Article 5) ────────────────────

/** A validated submission, as `POST /api/projects` hands one over. */
export interface NewProjectSubmission {
  title: string;
  body: string;
  /**
   * The byline — the session's display name. Null when the account has none,
   * which the gallery renders as "Anonymous". Since Phase 4 no typed value
   * reaches this: `POST /api/projects` requires sign-in (spec §5.5).
   */
  authorName: string | null;
  /**
   * `user.id`, from a resolved session and nowhere else. Still optional at this
   * layer because the column is: the import back-fills rows that predate
   * accounts, and `created_by` is nullable for exactly that reason.
   */
  authorUserId?: string | null;
  link?: string | null;
  materials?: readonly string[];
  /** Catalogue ids of the tools it was built with. Unknown ids are dropped. */
  toolIds?: readonly string[];
  /** `attachments.id`s uploaded for this project, cover first. */
  photoAttachmentIds?: readonly string[];
}

export interface CreatedProject {
  id: string;
  slug: string;
  /** How many of the submitted tool ids matched a real tool. */
  toolsLinked: number;
  /** How many of {@link NewProjectSubmission.photoAttachmentIds} actually attached. */
  photosAttached: number;
}

export interface ProjectWriteOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Record one project submission, **unpublished**.
 *
 * `published: false` is not a default this function is willing to be talked out
 * of: it takes no `published` parameter at all, so there is no argument a route
 * could forward that would put a submission straight in the gallery (Article 5).
 * Publishing is a person on `/admin/projects`.
 *
 * One transaction covers the slug, the row, the tool links and the photo
 * claim, so a failure anywhere leaves nothing behind. Two ideas are worth
 * knowing:
 *
 * - **The slug is allocated, not assumed.** `projects.slug` is unique, and two
 *   students submitting "Lamp" a second apart would otherwise collide. The
 *   allocation reads the slugs already taken in the same family and picks the
 *   next free suffix; the unique constraint is still the real arbiter, so a
 *   violation retries once against the now-current set rather than failing.
 * - **An unknown tool id is dropped, not fatal.** A stale catalogue id in a
 *   form that has been open a while must not cost a student their write-up
 *   (Article 4).
 *
 * No `revalidateTag("projects")` here, deliberately. §3.9 says writes
 * invalidate their tags, but every cached project read is published-only and
 * this row is not published, so there is nothing stale to bust — and busting
 * the whole gallery cache on every submission would be an invalidation that
 * costs reads and buys nothing. The tag belongs to Phase 5's publish.
 */
export async function createProjectSubmission(
  input: NewProjectSubmission,
  options: ProjectWriteOptions = {}
): Promise<CreatedProject> {
  const db = options.db ?? (await getDb());
  try {
    return await insertSubmission(db, input);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Somebody else took the slug between the read and the insert. The second
    // attempt reads a set that now includes theirs.
    return insertSubmission(db, input);
  }
}

async function insertSubmission(db: Db, input: NewProjectSubmission): Promise<CreatedProject> {
  return db.transaction(async (tx) => {
    const slug = await allocateSlug(tx, slugify(input.title));
    const authorUserId = input.authorUserId || null;

    const [row] = await tx
      .insert(projects)
      .values({
        slug,
        title: input.title,
        body: input.body,
        link: input.link || null,
        materials: [...(input.materials ?? [])],
        authorName: input.authorName || null,
        authorUserId,
        // Article 5. Not a parameter, deliberately.
        published: false,
        createdBy: authorUserId,
        updatedBy: authorUserId,
      })
      .returning({ id: projects.id });

    const toolsLinked = await linkTools(tx, row.id, input.toolIds ?? []);
    const photosAttached = await claimAttachments(tx, input.photoAttachmentIds ?? [], {
      ownerType: "project",
      ownerId: row.id,
    });

    return { id: row.id, slug, toolsLinked, photosAttached };
  });
}

/** The first free slug in the `base`, `base-2`, `base-3`, … family. */
async function allocateSlug(db: Db, base: string): Promise<string> {
  const rows = await db
    .select({ slug: projects.slug })
    .from(projects)
    // Only the family, not the whole table: a lab with a thousand projects
    // should not read a thousand slugs to name one (Article 4).
    .where(or(eq(projects.slug, base), like(projects.slug, `${base}-%`)));

  return uniqueSlug(base, new Set(rows.map((row) => row.slug)));
}

/** Insert `project_tools` rows for the ids that name a real tool; returns how many. */
async function linkTools(db: Db, projectId: string, toolIds: readonly string[]): Promise<number> {
  const candidates = [...new Set(toolIds.filter(isUuid))];
  if (candidates.length === 0) return 0;

  const existing = await db
    .select({ id: tools.id })
    .from(tools)
    .where(inArray(tools.id, candidates));
  if (existing.length === 0) return 0;

  await db.insert(projectTools).values(existing.map((tool) => ({ projectId, toolId: tool.id })));
  return existing.length;
}

/**
 * A Postgres unique-constraint violation (SQLSTATE 23505). Both drivers surface
 * the code somewhere on the error or its cause, so this reads the chain rather
 * than assuming either one's shape.
 */
function isUniqueViolation(err: unknown): boolean {
  for (let current: unknown = err, depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (candidate.code === "23505") return true;
    current = candidate.cause;
  }
  return false;
}

/** Attaches each row's photos and tool refs, then maps onto the view model. */
async function hydrateProjects(db: Db, rows: ProjectRow[]): Promise<MakerLabProject[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [photosByProject, toolsByProject] = await Promise.all([loadPhotos(db, ids), loadToolRefs(db, ids)]);

  return rows.map((row) => toMakerLabProject(row, photosByProject.get(row.id) ?? [], toolsByProject.get(row.id) ?? []));
}

/** Public attachment URLs owned by these projects, grouped by project id and ordered by `position`. */
async function loadPhotos(db: Db, projectIds: string[]): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ ownerId: attachments.ownerId, publicUrl: attachments.publicUrl })
    .from(attachments)
    .where(
      and(eq(attachments.ownerType, "project"), inArray(attachments.ownerId, projectIds), eq(attachments.access, "public"))
    )
    .orderBy(attachments.position);

  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.ownerId || !row.publicUrl) continue;
    const list = map.get(row.ownerId);
    if (list) list.push(row.publicUrl);
    else map.set(row.ownerId, [row.publicUrl]);
  }
  return map;
}

/** `{id,name,slug}` for each project's *published* tools, grouped by project id. An archived/draft tool drops the ref, not the project. */
async function loadToolRefs(db: Db, projectIds: string[]): Promise<Map<string, ProjectToolRef[]>> {
  const rows = await db
    .select({ projectId: projectTools.projectId, id: tools.id, name: tools.name, slug: tools.slug })
    .from(projectTools)
    .innerJoin(tools, eq(projectTools.toolId, tools.id))
    .where(and(inArray(projectTools.projectId, projectIds), eq(tools.published, true)))
    .orderBy(tools.name);

  const map = new Map<string, ProjectToolRef[]>();
  for (const row of rows) {
    const ref: ProjectToolRef = { id: row.id, name: row.name, slug: row.slug };
    const list = map.get(row.projectId);
    if (list) list.push(ref);
    else map.set(row.projectId, [ref]);
  }
  return map;
}

function toMakerLabProject(row: ProjectRow, photos: string[], toolRefs: ProjectToolRef[]): MakerLabProject {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    author: row.authorName ?? "Anonymous",
    body: row.body,
    photos,
    tools: toolRefs,
    link: row.link,
    materials: row.materials,
    date: row.createdAt.toISOString(),
  };
}
