import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../../components/admin/AdminPageHeader";
import { EmptyState } from "../../../../../components/system/EmptyState";
import { Button } from "@/components/ui/button";
import { ImportReview } from "../../../../../components/admin/ImportReview";
import { resolveIdentityFromHeaders } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { getBulkImport, type BulkImportRecord } from "../../../../../lib/data/bulk-imports";
import { listPendingTools, type PendingTool } from "../../../../../lib/data/pending-tools";
import { listCategories, listLocations } from "../../../../../lib/data/taxonomy";
import { canActOnImport, IMPORT_PERMISSION } from "../../../../../lib/import/access";
import { buildTablePreview, readImportTable, type TablePreview } from "../../../../../lib/import/preview";
import { toImportItemView, toImportView } from "../../../../../lib/import/view";
import { ADMIN_INTAKE_PATH } from "../../../../../lib/intake/types";
import { siteConfig } from "../../../../../lib/site-config";
import type { ImportActions } from "../action-result";
import {
  acceptImportSuggestions,
  confirmImportColumns,
  ignoreImportSuggestions,
  loadImport,
  mergeImportRow,
  removeImportRows,
  requestImportSuggestions,
  setImportRowHints,
  updateImportRow,
} from "../actions";

/**
 * `/admin/intake/imports/[id]` — one import (bulk intake spec §5 steps 1–4,
 * §6). Requires `tools.add` and the import to be the caller's (or `tools.approve`),
 * refused in words. Uncached: it exists to show a document being read and
 * suggestions arriving, and the island polls its own action for both.
 */

export const metadata = {
  title: `Import — ${siteConfig.name}`,
};

const ACTIONS: ImportActions = {
  load: loadImport,
  confirmColumns: confirmImportColumns,
  updateRow: updateImportRow,
  setHints: setImportRowHints,
  removeRows: removeImportRows,
  mergeRow: mergeImportRow,
  acceptSuggestions: acceptImportSuggestions,
  ignoreSuggestions: ignoreImportSuggestions,
  suggestNames: requestImportSuggestions,
};

/** Lines of the source shown when nothing was found in it (§5 unhappy paths). */
const HEAD_LINES = 12;

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await getTranslations("admin.import");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, IMPORT_PERMISSION)) return <AdminNotice kind="forbidden" />;

  const { id } = await params;
  let found: BulkImportRecord | null;
  let items: PendingTool[] = [];
  let categories: string[] = [];
  let locations: string[] = [];
  try {
    found = await getBulkImport(id);
    if (found) {
      const [rows, categoryOptions, locationOptions] = await Promise.all([
        listPendingTools({ importId: found.id, limit: null }),
        listCategories(),
        listLocations(),
      ]);
      items = rows.sort((a, b) => (a.sourceRow ?? 0) - (b.sourceRow ?? 0));
      categories = categoryOptions.map((category) => category.name);
      locations = [...new Set(locationOptions.flatMap((location) => [location.room, location.zone].filter(Boolean)))];
    }
  } catch (err) {
    console.error("[admin/intake/imports] could not read the import", err);
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="intake" item title={t("sectionTitle")} />
        <EmptyState tone="bad">{t("unavailable")}</EmptyState>
      </section>
    );
  }

  if (!found) {
    return (
      <section className="flex flex-col gap-4">
        <AdminPageHeader surface="intake" item title={t("sectionTitle")} />
        <EmptyState
          action={
            <Button asChild size="sm">
              <Link href={`${ADMIN_INTAKE_PATH}/imports`}>{t("backToImports")}</Link>
            </Button>
          }
        >
          {t("missing")}
        </EmptyState>
      </section>
    );
  }
  if (!canActOnImport(identity, found)) return <AdminNotice kind="forbidden" />;

  let preview: TablePreview | null = null;
  if (found.status === "mapping") {
    const table = readImportTable(found.sourceText, found.sourceName);
    preview = table ? buildTablePreview(table) : null;
  }
  const sourceHead =
    found.status === "failed"
      ? found.sourceText
          .split(/\r\n|\r|\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .slice(0, HEAD_LINES)
          .map((line) => line.slice(0, 200))
      : null;

  return (
    <ImportReview
      initialImport={toImportView(found)}
      initialItems={items.map(toImportItemView)}
      preview={preview}
      sourceHead={sourceHead}
      categories={categories}
      locations={locations}
      actions={ACTIONS}
    />
  );
}
