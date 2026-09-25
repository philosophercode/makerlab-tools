import { notFound, redirect } from "next/navigation";
import { DetailShell } from "../../../components/DetailShell";
import { archivedToolHref } from "../../../components/admin/inventory-filters";
import type { ToolEditorActions } from "../../../components/admin/tool-editor-actions";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { findToolByIdOrSlug } from "../../../lib/data/catalog";
import { EditToolControl } from "./EditToolControl";

/**
 * A draft tool at its own slug, for the people allowed to see one
 * (spec §5.3(b)).
 *
 * **Everyone else gets the 404 page**, and gets it for both reasons at once: a
 * slug nobody owns and a draft somebody may not see are the same refusal here.
 * A different-looking message for the second would confirm that the draft
 * exists, which is the thing `catalog.view_drafts` is withholding.
 *
 * **An archived tool sends staff to its row in Inventory** (amendment
 * 2026-09-25 "Archived tools send staff to Inventory"). Archived is still gone
 * from the tool page — nobody is shown it here — but somebody who just pressed
 * Archive, or followed an old link, lands where Restore is instead of on a 404.
 * Students and visitors still get the 404, so nothing is revealed to them.
 *
 * **Drafts carry the Edit control too**, so Publish, Restore and every other
 * edit are reachable from the draft's own page, as they are from a published
 * one.
 *
 * **It is a dynamic hole inside its own Suspense boundary, on purpose.**
 * `getCatalogTool` is `"use cache"` and published-only, and it cannot take an
 * identity — a cached read that varied by caller would serve one person's
 * answer to the next. So the published page keeps its fast path untouched, and
 * only the *miss* reads headers, inside a boundary. Doing it any higher would
 * mark the whole tool page dynamic under `cacheComponents` and lose the cache
 * for every visitor. `QrArrivalNotice` is the same shape above it.
 *
 * No projects are loaded: "Built with this" lists published projects, and a
 * tool that is not in the catalogue has none worth a second query.
 */

export async function DraftToolView({
  idOrSlug,
  actions,
}: {
  idOrSlug: string;
  /** The editor's actions, from the page; absent in tests that only check visibility. */
  actions?: ToolEditorActions;
}) {
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "catalog.view_drafts")) notFound();

  // Uncached and draft-inclusive — the opposite of `getCatalogTool` in both
  // respects, which is why it is a separate read rather than a flag on that one.
  const tool = await findToolByIdOrSlug(idOrSlug, { includeDrafts: true });
  if (!tool) {
    const archived = await findToolByIdOrSlug(idOrSlug, { includeDrafts: true, includeArchived: true });
    if (archived) redirect(archivedToolHref(archived.name));
    notFound();
  }

  return (
    <>
      <DetailShell tool={tool} />
      {actions ? <EditToolControl slug={tool.slug} toolName={tool.name} actions={actions} /> : null}
    </>
  );
}
