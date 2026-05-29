import { notFound } from "next/navigation";
import { ProjectDetail } from "../../../components/ProjectDetail";
import { getProject } from "../../../lib/projects";

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>;
}

// No `generateStaticParams`: the project set is empty without `NOTION_DB_PROJECTS`,
// which Cache Components rejects for prerender. Detail pages render on demand
// from the cached published set instead.

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps) {
  const { id } = await params;
  const project = await getProject(id);

  if (!project) {
    notFound();
  }

  return <ProjectDetail project={project} />;
}
