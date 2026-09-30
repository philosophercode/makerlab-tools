import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectDetail } from "../../../components/ProjectDetail";
import { SignedInProjectWorkMap } from "../../../components/map/SignedInProjectWorkMap";
import { getCatalogTools } from "../../../lib/catalog";
import { getProject } from "../../../lib/projects";
import { projectPageMetadata } from "./metadata";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

// No `generateStaticParams`: the project set is empty without `NOTION_DB_PROJECTS`,
// which Cache Components rejects for prerender. Detail pages render on demand
// from the cached published set instead.

/** The project's title and cover photo as the link preview (`./metadata.ts`). */
export async function generateMetadata({ params }: ProjectDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return projectPageMetadata(id);
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const [project, catalogue] = await Promise.all([getProject(id), getCatalogTools()]);

  if (!project) {
    notFound();
  }

  // The gallery's Materials facet values, so a project's materials can link
  // to the tools that work them. The cached catalogue the gallery warms.
  const galleryMaterials = [...new Set(catalogue.flatMap((tool) => tool.materials))];

  return (
    <ProjectDetail
      project={project}
      galleryMaterials={galleryMaterials}
      workMap={
        // Signed-in viewers only (map access): a dynamic hole, so the cached
        // shell sent to everyone else carries no placement.
        <Suspense fallback={null}>
          <SignedInProjectWorkMap tools={project.tools} />
        </Suspense>
      }
    />
  );
}
