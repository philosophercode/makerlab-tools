import { getTranslations } from "next-intl/server";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { LinkTabs } from "../../../../components/system/LinkTabs";
import { ADMIN_INTAKE_PATH } from "../../../../lib/intake/types";
import { IMPORT_PERMISSION } from "../../../../lib/import/access";
import { INTAKE_REVIEW_PERMISSION } from "../../../../lib/intake/access";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { loadAdminOverview } from "../../../../lib/data/admin-overview";

/**
 * **Add equipment** — one header over three tabs (UI system spec §8.1: "Add
 * equipment becomes one page with tabs — Queue · Imports · Import a list",
 * instead of imports being a list at the bottom of intake):
 *
 * - **Queue** `/admin/intake` — everything identified, researching or waiting
 *   for approval (`tools.approve`);
 * - **Imports** `/admin/intake/imports` — the recent imports, each resumable
 *   (`tools.add`);
 * - **Import a list** `/admin/intake/imports/new` (`tools.add`).
 *
 * A route group, not a merge: each tab keeps its own URL and its own
 * permission check, and a tab the viewer cannot open is not offered. One
 * item's page (`[id]`, `imports/[id]`) sits outside the group — it is about
 * that item, and its header links back here.
 *
 * The facts line is the queue's and the imports' counts, from the home's own
 * count loaders, so the numbers here and on the tiles are one read's.
 */

export default async function AddEquipmentLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const canReview = can(identity, INTAKE_REVIEW_PERMISSION);
  const canImport = can(identity, IMPORT_PERMISSION);

  // Neither tab is open to this person: the page underneath says so.
  if (!canReview && !canImport) return <>{children}</>;

  const overview = await loadAdminOverview([...(canReview ? (["intake"] as const) : []), ...(canImport ? (["imports"] as const) : [])]);
  const intake = overview.intake;
  const imports = overview.imports;

  const tabs = [
    ...(canReview ? [{ href: ADMIN_INTAKE_PATH, label: t("addEquipment.tabQueue") }] : []),
    ...(canImport
      ? [
          { href: `${ADMIN_INTAKE_PATH}/imports`, label: t("addEquipment.tabImports") },
          { href: `${ADMIN_INTAKE_PATH}/imports/new`, label: t("addEquipment.tabImport") },
        ]
      : []),
  ];

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        group="addEquipment"
        title={t("addEquipment.title")}
        lede={t("intakeLede")}
        facts={[
          ...(canReview
            ? intake
              ? [
                  t("facts.researched", { count: intake.researched }),
                  t("facts.identified", { count: intake.identified }),
                  t("facts.researching", { count: intake.researching }),
                  t("facts.failed", { count: intake.failed }),
                ]
              : [t("facts.unreadable")]
            : []),
          ...(canImport && imports ? [t("facts.importsReady", { count: imports.ready })] : []),
        ]}
      />
      <LinkTabs label={t("addEquipment.tabsLabel")} tabs={tabs} />
      {children}
    </section>
  );
}
