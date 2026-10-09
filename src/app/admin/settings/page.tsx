import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../components/admin/AdminPageHeader";
import { SettingsBlock } from "../../../components/admin/SettingsBlock";
import { RefreshCatalogButton } from "../../../components/RefreshCatalogButton";
import { mayOpen, surface } from "../../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";

/**
 * `/admin/settings` — the Settings section's **General** tab (admin sections
 * spec 2026-10-07): how this deployment is set up for the lab, in the few
 * settings that are not a surface of their own. The other tabs are the Notion
 * mirror, MCP (assistants connected from outside) and AI agents.
 *
 * - **Lab screen**: the link to `/kiosk`, the status screen for the wall.
 * - **Catalog**: Refresh catalog, the cache button that used to sit in the
 *   admin home's header (`tools.edit`; also in the ⌘K palette).
 * - **Your access tokens**: `/account/tokens`, for an MCP client that cannot
 *   sign in with Google.
 *
 * Open to everybody who reaches the admin (the surface's permission is every
 * admin-surface one); each control keeps its own rule, and the refresh route
 * checks `tools.edit` again.
 */

export const metadata = {
  title: "Settings",
};

export default async function AdminSettingsPage() {
  const t = await getTranslations("admin.settings");
  const identity = await resolveIdentityFromHeaders();

  if (!mayOpen(identity, surface("settings"))) return <AdminNotice kind="forbidden" />;

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader surface="settings" title={t("title")} lede={t("lede")} />

      <div className="ui grid gap-4 md:grid-cols-2">
        <SettingsBlock id="settings-lab-screen" title={t("labScreenTitle")} body={t("labScreenBody")}>
          <Link href="/kiosk" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("labScreenOpen")}
          </Link>
        </SettingsBlock>

        {can(identity, "tools.edit") ? (
          <SettingsBlock id="settings-catalog" title={t("catalogTitle")} body={t("catalogBody")}>
            <RefreshCatalogButton role={identity.role} />
          </SettingsBlock>
        ) : null}

        <SettingsBlock id="settings-tokens" title={t("tokensTitle")} body={t("tokensBody")}>
          <Link href="/account/tokens" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("tokensOpen")}
          </Link>
        </SettingsBlock>
      </div>
    </section>
  );
}
