import { Suspense } from "react";
import { permanentRedirect } from "next/navigation";
import { DraftToolView } from "./DraftToolView";
import { EditToolControl } from "./EditToolControl";
import { QrArrivalNotice } from "./QrArrivalNotice";
import { DetailShell } from "../../../components/DetailShell";
import { FlagButton } from "../../../components/FlagButton";
import { ToolChatStarters } from "../../../components/ToolChatStarters";
import { getCatalogTool, getManualContents } from "../../../lib/catalog";
import { findToolByNotionPageId } from "../../../lib/data/catalog";
import { isLegacyNotionId } from "../../../lib/legacy-id";
import { getProjectsForTool } from "../../../lib/projects";
import type { ToolEditorActions } from "../../../components/admin/tool-editor-actions";
import {
  archive,
  loadToolForEditor,
  markToolReviewed,
  publish,
  restore,
  saveTool,
  unpublish,
} from "../../admin/inventory/actions";
import { attachPhotos, removePhoto, reorderPhotos } from "../../admin/inventory/photo-actions";
import {
  addResource,
  editResource,
  removeResource,
  reprocessManual,
} from "../../admin/inventory/resource-actions";
import { addUnit, deleteUnit, editUnit, retireUnit } from "../../admin/inventory/unit-actions";

/**
 * The tool editor's actions, handed to the page's Edit control (spec §5.3(b)).
 *
 * The same endpoints `/admin/inventory` uses — one editor, one set of writes,
 * one place each permission is checked. They travel as props because a client
 * island that imported them would drag `next/headers` and the limiter into the
 * browser bundle; handing them down is not a grant, since every one of them
 * re-checks its own permission (§8).
 */
const EDITOR_ACTIONS: ToolEditorActions = {
  load: loadToolForEditor,
  save: saveTool,
  markReviewed: markToolReviewed,
  publish,
  unpublish,
  archive,
  restore,
  addUnit,
  editUnit,
  retireUnit,
  deleteUnit,
  addResource,
  editResource,
  removeResource,
  reprocessManual,
  attachPhotos,
  reorderPhotos,
  removePhoto,
};

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
    // falls through to the draft check below.
    if (isLegacyNotionId(id)) {
      const match = await findToolByNotionPageId(id);
      if (match) {
        const query = preserveQueryString(await searchParams);
        permanentRedirect(`/tools/${match.slug}${query}`);
      }
    }

    // The catalogue read is cached and published-only, so a miss is not yet a
    // 404: it may be a draft, and somebody holding `catalog.view_drafts` is
    // allowed to open it (§5.3(b)). The identity read happens inside this
    // boundary and nowhere above it, which is what keeps every *published*
    // tool page prerenderable. `DraftToolView` calls `notFound()` for everyone
    // else — the same refusal a slug nobody owns gets, so neither answer
    // reveals that a draft exists.
    return (
      <Suspense fallback={null}>
        <DraftToolView idOrSlug={id} actions={EDITOR_ACTIONS} />
      </Suspense>
    );
  }

  // "Built with this" — published projects referencing this tool (empty if no
  // projects DB is configured).
  const projects = await getProjectsForTool(tool.id);
  // Each processed manual's chapters, linked to their pages (manual text spec §6).
  const manualContents = await getManualContents(tool.id);

  return (
    <>
      {/* Arrivals from a QR label on a machine get the assistant surfaced above
          the specs. Suspended so reading `?src=qr` stays a dynamic hole and the
          prerendered detail shell below is untouched. */}
      <Suspense fallback={null}>
        <QrArrivalNotice toolName={tool.name} />
      </Suspense>
      <DetailShell tool={tool} projects={projects} manualContents={manualContents} />
      {/* The assistant's starter chips for this tool, handed to the chat in
          the layout; nothing is rendered (amendment "Tool-specific starter
          questions"). */}
      <ToolChatStarters slug={tool.slug} id={tool.id} questions={tool.starterQuestions ?? []} />
      {/* Edit mode, phone-first (§5.3(b)). Another dynamic hole of its own:
          the control asks `/api/identity` after mount, so the shell above it
          stays cached for the visitors who are not staff. */}
      <EditToolControl slug={tool.slug} toolName={tool.name} actions={EDITOR_ACTIONS} />
      {/* Quiet footer control for reporting a wrong field (report-a-correction
          spec §6). Deliberately below the content, not competing with it. */}
      <FlagButton toolId={tool.id} />
    </>
  );
}
