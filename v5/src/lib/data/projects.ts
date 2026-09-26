import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { attachments, projectTools, projects, tools } from "../db/schema/index.ts";
import { slugify, uniqueSlug } from "../db/slug.ts";
import type { Db } from "../db/types.ts";
import { accountRemoved } from "./account-removed.ts";
import { claimAttachments } from "./attachments.ts";
import { isUniqueViolation } from "./pg-errors.ts";
import { isUuid } from "./uuid.ts";
import type { MakerLabProject, ProjectToolRef } from "../../components/catalog-types.ts";

/**
 * Postgres reads for published projects (data platform design spec 2026-09-14
 * §3.10, §4.10, §4.13), since Phase 3 the submission write, and since Phase 5
 * the moderation pair at the bottom of the file — the one read here that sees
 * unpublished rows, and the write that publishes one (§5.6). This is the query
 * module `src/lib/projects.ts` wraps in `"use cache"`; nothing here is cached
 * itself, so every export is a plain round trip and safe to call as often as
 * the caller needs a fresh answer.
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

// ── Moderation (spec §5.6, §4.10, Article 5) ────────────────────────

/**
 * One submission as `/admin/projects` decides about it.
 *
 * Its own shape rather than `MakerLabProject`, because the question is a
 * different one. The gallery view answers "what is this project"; this answers
 * "should this be in the gallery" — so it carries `published`, who is asking
 * to be published, and the photos and body a moderator reads before saying
 * yes. `toolRefs` are deliberately not here: what a project was built with does
 * not bear on whether it may be shown, and the moderator can open the project
 * to see them.
 */
export interface ProjectModerationEntry {
  id: string;
  slug: string;
  title: string;
  /** The byline. `"Anonymous"` is the gallery's word, not this page's. */
  authorName: string;
  authorUserId: string | null;
  /** The author's account has been removed; the name above is the snapshot. */
  authorRemoved: boolean;
  body: string;
  link: string | null;
  materials: string[];
  /** Public photo URLs, cover first. */
  photos: string[];
  published: boolean;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface ProjectModerationOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** How many submissions to read. */
  limit?: number;
}

/**
 * Bounded like every read here (Article 4). A moderation queue is a backlog to
 * clear, and a page of two hundred is already a bad sign.
 */
const MODERATION_LIMIT = 200;

/**
 * Every project, **unpublished first** (spec §5.6).
 *
 * The one read in this module that does not filter `published = true`, which
 * is the point: everything else here serves the gallery, and a submission
 * nobody has approved is invisible to all of it (Article 5). Published rows
 * stay in the list because unpublishing is the other half of the gate — taking
 * something down is the same page's job as putting it up.
 *
 * Two statements: the rows, then their photos grouped by project, the same
 * helper the gallery uses.
 */
export async function listProjectsForModeration(
  options: ProjectModerationOptions = {}
): Promise<ProjectModerationEntry[]> {
  const db = options.db ?? (await getDb());

  const rows = await db
    .select({ row: projects, authorRemoved: accountRemoved(projects.authorUserId) })
    .from(projects)
    // `published` is a boolean and `false` sorts first ascending, which is the
    // order the queue is worked in. Newest first within each half: a submission
    // from this morning is the one somebody is waiting on.
    .orderBy(asc(projects.published), desc(projects.createdAt))
    .limit(options.limit ?? MODERATION_LIMIT);

  if (rows.length === 0) return [];

  const photosByProject = await loadPhotos(
    db,
    rows.map(({ row }) => row.id)
  );

  return rows.map(({ row, authorRemoved }) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    authorName: row.authorName ?? "",
    authorUserId: row.authorUserId,
    authorRemoved: Boolean(authorRemoved),
    body: row.body,
    link: row.link,
    materials: row.materials,
    photos: photosByProject.get(row.id) ?? [],
    published: row.published,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  }));
}

export type ProjectModerationResult =
  | { ok: true; publishedAt: Date | null }
  | { ok: false; reason: "not_found" };

/**
 * Publish or unpublish one project — the approval Article 5 requires.
 *
 * **`published_at` and `published_by` describe the current publication, not the
 * history**, so unpublishing clears both. The history is `audit_events`, which
 * records every publish and unpublish with its actor and is append-only by
 * construction (§4.11); leaving a stamp behind on a row that is not published
 * would give the columns two meanings, and the one a reader would guess is the
 * wrong one.
 *
 * `published_at` is the database's `now()` rather than the caller's clock, for
 * the reason `recordAuditEvent` gives: a serverless instance with a skewed
 * clock must not be able to order the gallery wrongly.
 *
 * No cache invalidation here. This module is loaded by `scripts/` under plain
 * Node, where `next/cache` does not exist — the server action calls
 * `invalidateProjects()` after this returns, and it must, because unlike
 * {@link createProjectSubmission} this write *does* change what the cached
 * gallery should show.
 *
 * Throws on a database failure; the caller reports that as `failed`.
 */
export async function setProjectPublished(
  projectId: string,
  published: boolean,
  options: ProjectWriteOptions & { actorUserId?: string | null } = {}
): Promise<ProjectModerationResult> {
  if (!isUuid(projectId)) return { ok: false, reason: "not_found" };

  const db = options.db ?? (await getDb());
  const actorUserId = options.actorUserId || null;

  const [row] = await db
    .update(projects)
    .set({
      published,
      publishedAt: published ? sql`now()` : null,
      publishedBy: published ? actorUserId : null,
      updatedBy: actorUserId,
    })
    .where(eq(projects.id, projectId))
    .returning({ publishedAt: projects.publishedAt });

  return row ? { ok: true, publishedAt: row.publishedAt } : { ok: false, reason: "not_found" };
}
