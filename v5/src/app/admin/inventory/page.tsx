import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { InventoryFilters } from "../../../components/admin/InventoryFilters";
import { UnlinkedUnits } from "../../../components/admin/UnlinkedUnits";
import {
  parseInventoryFilters,
  type SearchParams,
} from "../../../components/admin/inventory-filters";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { listInventoryRows, listUnlinkedUnits } from "../../../lib/data/inventory";
import { siteConfig } from "../../../lib/site-config";
import type { ToolEditorActions } from "../../../components/admin/tool-editor-actions";
import {
  archive,
  loadToolForEditor,
  markToolReviewed,
  publish,
  restore,
  saveTool,
  unpublish,
} from "./actions";
import { attachPhotos, removePhoto, reorderPhotos } from "./photo-actions";
import { addResource, editResource, removeResource, reprocessManual } from "./resource-actions";
import { addUnit, deleteUnit, editUnit, retireUnit } from "./unit-actions";
import { queueToolRefresh } from "../refresh/actions";

/**
 * `/admin/inventory` — the review table (spec §5.3(a), §6).
 *
 * Requires `tools.edit`. The layout above answered the coarse question and let
 * anyone holding an admin permission through; the exact refusal happens here
 * and is *said*, the way `/admin/users` says it. A 404 would claim the page
 * does not exist, which is a lie told to somebody who is signed in.
 *
 * **Nothing here is cached.** A review table is a picture of what is true right
 * now — the one thing it must not do is show a row somebody already fixed. The
 * identity read makes this subtree dynamic anyway, and the filters are read
 * from the URL, which is dynamic for the same reason.
 *
 * The rows are read whole and filtered in the browser (see `InventoryFilters`),
 * so changing a facet costs nothing and the URL stays linkable.
 *
 * **The editor's actions travel down as props.** A client island that imported
 * them would drag `next/headers`, the limiter and `server-only` into the
 * browser bundle and stop being testable; and the same panel is offered from a
 * tool's own page, which has no access to this one. Each action re-checks its
 * own permission regardless — handing one down is not a grant (§8).
 */

/**
 * The bundle `ToolEditorPanel` receives. Built here rather than exported from
 * `actions.ts`, because a `"use server"` module may export only async
 * functions.
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

export const metadata = {
  title: `Inventory — ${siteConfig.name}`,
};

export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();

  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  const [params, rows, unlinked] = await Promise.all([
    searchParams,
    listInventoryRows(),
    listUnlinkedUnits(),
  ]);

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("inventoryTitle")}</h2>
        {/* No placeholder in this string: `/admin/page.tsx` renders the same
            key without arguments, and a next-intl placeholder with no argument
            renders literally (Article 6 — this has been a real bug here). */}
        <p className="admin-lede">{t("inventoryLede")}</p>
      </header>

      <UnlinkedUnits units={unlinked} />

      <InventoryFilters
        rows={rows}
        initial={parseInventoryFilters(params)}
        actions={EDITOR_ACTIONS}
        // Hiding the publish controls from somebody who only holds `tools.edit`
        // is presentation; the actions check `tools.publish` themselves.
        canPublish={can(identity, "tools.publish")}
        // Refresh research is `tools.edit`, which this page already requires.
        queueRefresh={queueToolRefresh}
      />
    </section>
  );
}
