import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ADMIN_HOME, surface as surfaceFor, type SurfaceKey } from "../../lib/admin/surfaces";
import { PageHeader } from "../system/PageHeader";
import { SectionTabs } from "./SectionTabs";

/**
 * Every admin page's header (UI system spec §8.1; admin sections spec
 * 2026-10-07; DESIGN.md §8.1): the `// ADMIN / INVENTORY` crumb from the
 * surface's section, the title, a one-line lede, the **facts line** — the
 * page's key numbers as words (`2 TOOLS · 2 PUBLISHED · 0 DRAFTS · 2 NEED
 * ATTENTION`) — and the page's actions on the right. Under it, the section's
 * tabs (`SectionTabs`): the other pages of the same section the viewer may
 * open.
 *
 * A page about one thing inside a surface (a refresh, an intake item, an
 * import) passes `item`: the surface joins the crumb as a link back, the
 * thing's name is the title, and no tabs are drawn, since the page is about
 * the item and not one of the section's views.
 *
 * The overview passes no surface: its crumb is `// ADMIN` alone.
 *
 * The title is the page's h2; the layout's `sr-only` h1 names the admin.
 */
export interface AdminPageHeaderProps {
  /** The surface the page belongs to. None on the overview. */
  surface?: SurfaceKey;
  title: string;
  lede?: ReactNode;
  /** The key numbers, as translated phrases; falsy entries are dropped. */
  facts?: ReadonlyArray<string | null | false | undefined>;
  actions?: ReactNode;
  /** A page about one item of the surface: the surface becomes a crumb link. */
  item?: boolean;
}

export function AdminPageHeader({ surface, title, lede, facts = [], actions, item = false }: AdminPageHeaderProps) {
  const t = useTranslations("admin");
  const entry = surface ? surfaceFor(surface) : null;
  const crumbs = [
    { label: t("eyebrow"), href: ADMIN_HOME },
    ...(entry ? [{ label: t(`nav.section.${entry.section}`) }] : []),
    ...(entry && item ? [{ label: t(`nav.surface.${entry.key}`), href: entry.href }] : []),
  ];
  const said = facts.filter((fact): fact is string => Boolean(fact));

  return (
    <>
      <PageHeader
        crumbs={crumbs}
        title={title}
        lede={lede}
        actions={actions}
        facts={said.length > 0 ? said.join(" · ") : undefined}
      />
      {entry && !item ? <SectionTabs section={entry.section} /> : null}
    </>
  );
}
