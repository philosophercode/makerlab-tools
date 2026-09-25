import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../../../components/admin/AdminNotice";
import { ImportLauncher } from "../../../../../../components/admin/ImportLauncher";
import { resolveIdentityFromHeaders } from "../../../../../../lib/auth/identity";
import { can } from "../../../../../../lib/auth/permissions";
import { IMPORT_PERMISSION } from "../../../../../../lib/import/access";
import { siteConfig } from "../../../../../../lib/site-config";

/**
 * `/admin/intake/imports/new` — Add equipment's **Import a list** tab (bulk
 * intake spec §5 step 1). Requires `tools.add`, refused in words like every
 * admin page. The header and tabs are the route group's layout.
 */

export const metadata = {
  title: `Import a list — ${siteConfig.name}`,
};

export default async function NewImportPage() {
  const t = await getTranslations("admin.import");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, IMPORT_PERMISSION)) return <AdminNotice kind="forbidden" />;

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[72ch] text-sm text-muted-foreground">{t("lede")}</p>
      <ImportLauncher />
    </div>
  );
}
