import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ADMIN_HOME, surface as surfaceFor, type AdminGroup, type SurfaceKey } from "../../lib/admin/surfaces";
import { PageHeader } from "../system/PageHeader";

/**
 * Every admin page's header (UI system spec §8.1; DESIGN.md §8.1): the
 * `// ADMIN / KEEP DATA FRESH` crumb from the surface's group, the title, a
 * one-line lede, the **facts line** — the page's key numbers as words
 * (`2 TOOLS · 2 PUBLISHED · 0 DRAFTS · 2 NEED ATTENTION`) — and the page's
 * actions on the right. It replaces `admin-section-head` + `td-eyebrow` +
 * `admin-lede` on every admin page.
 *
 * A page about one thing inside a surface (a refresh, an intake item, an
 * import) passes `item`: the surface joins the crumb as a link back, and the
 * thing's name is the title.
 *
 * The title is the page's h2; the layout's `sr-only` h1 names the admin.
 */
export interface AdminPageHeaderProps {
  /** The surface the page belongs to. */
  surface?: SurfaceKey;
  /** For a page that is not a surface's (the home, Add equipment's tabs). */
  group?: AdminGroup;
  title: string;
  lede?: ReactNode;
  /** The key numbers, as translated phrases; falsy entries are dropped. */
  facts?: ReadonlyArray<string | null | false | undefined>;
  actions?: ReactNode;
  /** A page about one item of the surface: the surface becomes a crumb link. */
  item?: boolean;
}

export function AdminPageHeader({ surface, group, title, lede, facts = [], actions, item = false }: AdminPageHeaderProps) {
  const t = useTranslations("admin");
  const entry = surface ? surfaceFor(surface) : null;
  const jobGroup = entry?.group ?? group;
  const crumbs = [
    { label: t("eyebrow"), href: ADMIN_HOME },
    ...(jobGroup ? [{ label: t(`nav.group.${jobGroup}`) }] : []),
    ...(entry && item ? [{ label: t(`nav.surface.${entry.key}`), href: entry.href }] : []),
  ];
  const said = facts.filter((fact): fact is string => Boolean(fact));

  return (
    <PageHeader
      crumbs={crumbs}
      title={title}
      lede={lede}
      actions={actions}
      facts={said.length > 0 ? said.join(" · ") : undefined}
    />
  );
}
