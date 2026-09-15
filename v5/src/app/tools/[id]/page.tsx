import { Suspense } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { QrArrivalNotice } from "./QrArrivalNotice";
import { DetailShell } from "../../../components/DetailShell";
import { FlagButton } from "../../../components/FlagButton";
import { getCatalogTool } from "../../../lib/catalog";
import { findToolByNotionPageId } from "../../../lib/data/catalog";
import { isLegacyNotionId } from "../../../lib/legacy-id";
import { getProjectsForTool } from "../../../lib/projects";

interface ToolDetailPageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// No `generateStaticParams`: enumerating the slugs would make `next build`
// depend on the database, which the client is explicitly designed not to
// require — `DATABASE_URL` may be unset, Neon may be asleep, and PGlite cannot
// run inside the bundled build (spec §3.2). Tool pages render on first request
// instead and are then served from the cache, which is where they came from
// anyway: every catalogue read is `"use cache"` + `cacheTag("catalog")`, so a
// later write invalidates them by tag rather than waiting for the next build
// (spec §3.9). `/projects/[id]` skips it for the same reason.

/**
 * Re-encodes the incoming query string for a redirect target. `?src=qr` is
 * the case that matters (`QrArrivalNotice` reads it on whatever page it lands
 * on), but nothing here is specific to that one key — a legacy link keeps
 * whatever it was carrying.
 */
function preserveQueryString(searchParams: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) qs.append(key, v);
  }
  const serialized = qs.toString();
  return serialized ? `?${serialized}` : "";
}

export default async function ToolDetailPage({ params, searchParams }: ToolDetailPageProps) {
  const { id } = await params;
  const tool = await getCatalogTool(id);

  if (!tool) {
    // Printed QR labels and old links encode a Notion page id rather than a
    // slug (spec Goal 2). A match redirects permanently to the tool's current
    // slug; anything else — a stale id, a typo, a slug that never existed —
    // 404s exactly as it did before this check existed.
    if (isLegacyNotionId(id)) {
      const match = await findToolByNotionPageId(id);
      if (match) {
        const query = preserveQueryString(await searchParams);
        permanentRedirect(`/tools/${match.slug}${query}`);
      }
    }
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
