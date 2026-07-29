import { Suspense } from "react";
import { notFound } from "next/navigation";
import { QrArrivalNotice } from "./QrArrivalNotice";
import { DetailShell } from "../../../components/DetailShell";
import { FlagButton } from "../../../components/FlagButton";
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

  return (
    <>
      {/* Arrivals from a QR label on a machine get the assistant surfaced above
          the specs. Suspended so reading `?src=qr` stays a dynamic hole and the
          prerendered detail shell below is untouched. */}
      <Suspense fallback={null}>
        <QrArrivalNotice toolName={tool.name} />
      </Suspense>
      <DetailShell tool={tool} projects={projects} />
      {/* Quiet footer control for reporting a wrong field (report-a-correction
          spec §6). Deliberately below the content, not competing with it. */}
      <FlagButton toolId={tool.id} />
    </>
  );
}
