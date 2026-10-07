"use client";

import { useTranslations } from "next-intl";
import type { AdminSection } from "../../lib/admin/surfaces";
import { LinkTabs } from "../system/LinkTabs";
import { useAdminSurfaces } from "./AdminSurfacesContext";

/**
 * The tabs under an admin page's header (admin sections spec 2026-10-07;
 * DESIGN.md §8.12): the surfaces of the page's section that the viewer may
 * open, as `LinkTabs` (links with `aria-current`, never `role="tab"`). The
 * Inventory section reads `ALL TOOLS · ADD EQUIPMENT · QR LABELS · LAB NOTES ·
 * MANUALS · CHECK FOR UPDATES · CATEGORIES · PAGE CORRECTIONS`.
 *
 * A section with one surface open to the viewer (Insights, a SuperMaker's
 * People) draws no tabs: one tab is a heading, not a choice. The surfaces
 * come from the layout (`AdminSurfacesProvider`), so a tab that would refuse
 * the viewer is never drawn. Not printed.
 */
export function SectionTabs({ section }: { section: Exclude<AdminSection, "overview"> }) {
  const t = useTranslations("admin.nav");
  const items = useAdminSurfaces();
  const tabs = (items ?? []).filter((item) => item.section === section);
  if (tabs.length < 2) return null;
  return (
    <LinkTabs
      label={t("sectionTabs", { section: t(`section.${section}`) })}
      className="print:hidden"
      tabs={tabs.map((item) => ({ href: item.href, label: t(`surface.${item.key}`) }))}
    />
  );
}
