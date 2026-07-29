import { cacheLife, cacheTag } from "next/cache";
import { fetchAllProjects, hasProjectsEnv } from "./notion";
import type { ProjectRecord } from "./types";
import type { MakerLabProject, ProjectToolRef } from "../components/catalog-types";
import { getCatalogTools } from "./catalog";

// Cached, published-only view of every project. Behind `"use cache"` with the
// `projects` tag so the admin revalidate endpoint can bust it on publish.
async function fetchPublishedProjects(): Promise<ProjectRecord[]> {
  "use cache";
  cacheTag("projects");
  cacheLife("minutes");

  return fetchAllProjects({ publishedOnly: true });
}

async function toMakerLabProjects(
  records: ProjectRecord[]
): Promise<MakerLabProject[]> {
  // Resolve tool relation ids → {id,name,slug} via the catalog (slug === id).
  const tools = await getCatalogTools();
  const toolMap = new Map<string, ProjectToolRef>(
    tools.map((tool) => [tool.id, { id: tool.id, name: tool.name, slug: tool.slug }])
  );

  return records.map((record) => toMakerLabProject(record, toolMap));
}

function toMakerLabProject(
  record: ProjectRecord,
  toolMap: Map<string, ProjectToolRef>
): MakerLabProject {
  const fields = record.fields;
  return {
    id: record.id,
    title: fields.title,
    author: fields.author || "Anonymous",
    body: fields.body || "",
    // Notion file URLs are signed and expire; surfaced as-is for the short
    // cacheLife window (mirrors the catalog image approach).
    photos: (fields.photos || []).map((photo) => photo.url).filter(Boolean),
    tools: (fields.tools_used || [])
      .map((id) => toolMap.get(id))
      .filter((ref): ref is ProjectToolRef => Boolean(ref)),
    link: fields.link || null,
    materials: fields.materials || [],
    date: fields.date || record.createdTime || null,
  };
}

export async function getPublishedProjects(): Promise<MakerLabProject[]> {
  if (!hasProjectsEnv()) return [];

  try {
    const records = await fetchPublishedProjects();
    return toMakerLabProjects(records);
  } catch (error) {
    console.warn("Failed to load projects:", error);
    return [];
  }
}

export async function getProject(id: string): Promise<MakerLabProject | null> {
  if (!hasProjectsEnv()) return null;

  // Resolve from the cached published set so unpublished projects never surface
  // via the detail route either.
  const projects = await getPublishedProjects();
  return projects.find((project) => project.id === id) || null;
}

/**
 * Published projects that reference a given tool id (the "Built with this"
 * section on the tool detail). Derived by scanning each project's
 * `tools_used`. Returns [] when no projects DB is configured.
 */
export async function getProjectsForTool(
  toolId: string
): Promise<MakerLabProject[]> {
  const projects = await getPublishedProjects();
  return projects.filter((project) =>
    project.tools.some((tool) => tool.id === toolId)
  );
}
