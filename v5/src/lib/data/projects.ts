import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { attachments, projectTools, projects, tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";
import type { MakerLabProject, ProjectToolRef } from "../../components/catalog-types.ts";

/**
 * Postgres reads for published projects (data platform design spec 2026-09-14
 * §3.10, §4.10, §4.13). This is the query module `src/lib/projects.ts` wraps
 * in `"use cache"`; nothing here is cached itself, so every export is a plain
 * round trip and safe to call as often as the caller needs a fresh answer.
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
