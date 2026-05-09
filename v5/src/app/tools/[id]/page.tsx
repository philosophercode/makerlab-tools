import { notFound } from "next/navigation";
import { DetailShell } from "../../../components/DetailShell";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";

interface ToolDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export const revalidate = 3600;

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

  return <DetailShell tool={tool} />;
}
