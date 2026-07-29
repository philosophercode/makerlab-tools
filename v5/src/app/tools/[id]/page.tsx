import { notFound } from "next/navigation";
import { DetailShell } from "../../../components/DetailShell";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import { getProjectsForTool } from "../../../lib/projects";

interface ToolDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export async function generateStaticParams() {
  const tools = await getCatalogTools();

  return tools.map((tool) => ({
    id: tool.slug,
  }));
}

export default async function ToolDetailPage({ params }: ToolDetailPageProps) {
  const { id } = await params;
  const tool = await getCatalogTool(id);

  if (!tool) {
    notFound();
  }

  // "Built with this" — published projects referencing this tool (empty if no
  // projects DB is configured).
  const projects = await getProjectsForTool(tool.id);

  return <DetailShell tool={tool} projects={projects} />;
}
