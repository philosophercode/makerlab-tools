import { AdminNotice } from "../../../../../components/admin/AdminNotice";
import { ImportsList } from "../../../../../components/admin/ImportsList";
import { resolveIdentityFromHeaders } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { listBulkImports } from "../../../../../lib/data/bulk-imports";
import { IMPORT_PERMISSION } from "../../../../../lib/import/access";
import { toImportView, type ImportView } from "../../../../../lib/import/view";
import { siteConfig } from "../../../../../lib/site-config";

/**
 * `/admin/intake/imports` — Add equipment's **Imports** tab (UI system phase
 * 4; bulk intake spec §6): the recent imports, each resumable from here. They
 * were a section under the intake queue; a tab of their own keeps a
 * half-reviewed import one click from the section bar without burying the
 * queue under it.
 *
 * Requires `tools.add`, refused in words. A list that cannot be read says so,
 * never "no imports" (Article 4).
 */

export const metadata = {
  title: `Imports — ${siteConfig.name}`,
};

export default async function AdminImportsPage() {
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, IMPORT_PERMISSION)) return <AdminNotice kind="forbidden" />;

  let imports: ImportView[] | null;
  try {
    imports = (await listBulkImports()).map((record) => toImportView(record));
  } catch (err) {
    console.error("[admin/intake/imports] could not read the imports", err);
    imports = null;
  }

  return <ImportsList imports={imports} />;
}
