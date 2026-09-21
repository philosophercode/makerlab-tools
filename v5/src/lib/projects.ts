import { cacheLife, cacheTag } from "next/cache";
import { findPublishedProject, listPublishedProjects, listPublishedProjectsForTool } from "./data/projects";
import type { MakerLabProject } from "../components/catalog-types";

// Cached, published-only reads over `src/lib/data/projects.ts`. Every export
// below shares the `projects` cache tag (spec §3.9), so publishing,
// unpublishing or editing a project in `/admin/projects` busts every one of
// these with a single `revalidateTag("projects")` / `updateTag("projects")`
// call. A thrown database read is not caught here: it surfaces as a stale
// cached page (Article 4, fail toward stale), never an invented empty result.

async function fetchPublishedProjects(): Promise<MakerLabProject[]> {
  "use cache";
  cacheTag("projects");
  cacheLife("minutes");

  return listPublishedProjects();
}

async function fetchProject(idOrSlug: string): Promise<MakerLabProject | null> {
  "use cache";
  cacheTag("projects");
  cacheLife("minutes");

  return findPublishedProject(idOrSlug);
}

async function fetchProjectsForTool(toolId: string): Promise<MakerLabProject[]> {
  "use cache";
  cacheTag("projects");
  cacheLife("minutes");

  return listPublishedProjectsForTool(toolId);
}

export async function getPublishedProjects(): Promise<MakerLabProject[]> {
  return fetchPublishedProjects();
}

export async function getProject(idOrSlug: string): Promise<MakerLabProject | null> {
  return fetchProject(idOrSlug);
}

/**
 * Published projects that reference a given tool id (the "Built with this"
 * section on the tool detail).
 */
export async function getProjectsForTool(toolId: string): Promise<MakerLabProject[]> {
  return fetchProjectsForTool(toolId);
}
