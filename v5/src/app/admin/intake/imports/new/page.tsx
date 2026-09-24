import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../../components/admin/AdminNotice";
import { ImportLauncher } from "../../../../../components/admin/ImportLauncher";
import { resolveIdentityFromHeaders } from "../../../../../lib/auth/identity";
import { can } from "../../../../../lib/auth/permissions";
import { IMPORT_PERMISSION } from "../../../../../lib/import/access";
import { ADMIN_INTAKE_PATH } from "../../../../../lib/intake/types";
import { siteConfig } from "../../../../../lib/site-config";

/**
 * `/admin/intake/imports/new` — **Import a list** (bulk intake spec §5 step
 * 1). Requires `tools.add`, refused in words like every admin page.
 */

export const metadata = {
  title: `Import a list — ${siteConfig.name}`,
};

export default async function NewImportPage() {
  const t = await getTranslations("admin.import");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, IMPORT_PERMISSION)) return <AdminNotice kind="forbidden" />;

  return (
    <section className="admin-section">
      <header className="admin-section-head">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h2>{t("title")}</h2>
        <p className="admin-lede">{t("lede")}</p>
        <p>
          <Link href={ADMIN_INTAKE_PATH}>{t("backToIntake")}</Link>
        </p>
      </header>
      <ImportLauncher />
    </section>
  );
}
