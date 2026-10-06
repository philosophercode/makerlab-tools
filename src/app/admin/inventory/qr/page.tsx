import { getTranslations } from "next-intl/server";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader } from "../../../../components/admin/AdminPageHeader";
import { QrLabelStudio, type QrLabelRow } from "../../../../components/admin/qr/QrLabelStudio";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import { listInventoryRows } from "../../../../lib/data/inventory";
import { listToolUnitOptions } from "../../../../lib/data/tool-options";
import { qrSiteUrl } from "../../../../lib/qr/site-url";
import { siteConfig } from "../../../../lib/site-config";

/**
 * `/admin/inventory/qr` — **QR labels** (QR labels spec): print a code for
 * each machine so anybody who sees it can scan it and land on its page.
 *
 * Requires `tools.edit`, the inventory's own permission (admins and super
 * admins); anybody else the admin layout lets through is told so here, as on
 * every admin page. Published tools only — a draft has no public page for a
 * code to open — read uncached with the review table's own query.
 *
 * Each tool row carries its units — retired ones left out, the same list
 * **Log completed maintenance** offers (`listToolUnitOptions`) — so the
 * studio can print a label per machine as well as per tool (QR codes spec
 * amendment 2026-10-06, "Unit labels").
 *
 * Everything after the list is the browser's: the styler, the preview and the
 * PDF (`QrLabelStudio`), so choosing a size costs no round trip. Printing
 * writes nothing, so there is no server action and nothing to audit.
 */

export const metadata = {
  title: `QR labels — ${siteConfig.name}`,
};

export default async function AdminQrLabelsPage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "tools.edit")) return <AdminNotice kind="forbidden" />;

  const [inventory, unitOptions] = await Promise.all([listInventoryRows(), listToolUnitOptions()]);
  const unitsByTool = new Map(unitOptions.map((tool) => [tool.id, tool.units.map((unit) => ({ id: unit.id, name: unit.label }))]));
  const rows: QrLabelRow[] = inventory
    .filter((row) => row.state === "published")
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      category: row.categoryName,
      room: row.room,
      zone: row.zone,
      units: unitsByTool.get(row.id) ?? [],
    }));

  return (
    <section className="flex flex-col gap-4">
      <AdminPageHeader
        surface="inventory"
        item
        title={t("qrLabels.title")}
        lede={t("qrLabels.lede")}
        facts={[t("facts.published", { count: rows.length })]}
      />
      <QrLabelStudio rows={rows} origin={qrSiteUrl()} wordmarkHref={siteConfig.wordmark} />
    </section>
  );
}
