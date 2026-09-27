import Link from "next/link";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * One page header for every working surface (spec §7.2; DESIGN.md §8.1): a
 * mono breadcrumb (`// ADMIN / INVENTORY`, the `//` in the accent ink), the
 * title, an optional one-line lede, the page's actions on the right, and a
 * facts line under it — the page's key numbers said as words
 * (`101 TOOLS · 86 PUBLISHED · 11 DRAFTS`).
 *
 * It replaces the admin layout's 88px "ADMIN" heading stacked over each page's
 * own `td-eyebrow` + h2, and `admin-section-head`. The gallery and the tool
 * page keep their display heroes. At most one filled Button in `actions`.
 *
 * Every string arrives translated; the breadcrumb's landmark name comes from
 * the `ui` messages.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  crumbs?: readonly Crumb[];
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  facts?: React.ReactNode;
  /** The title's heading level: `h1` on a page with no other h1, else `h2`. */
  as?: "h1" | "h2";
  titleId?: string;
  className?: string;
}

export function PageHeader({ title, crumbs = [], lede, actions, facts, as: Heading = "h2", titleId, className }: PageHeaderProps) {
  const t = useTranslations("ui");
  return (
    <header data-slot="page-header" className={cn("ui flex flex-col gap-2 pb-4", className)}>
      {crumbs.length > 0 ? (
        <nav aria-label={t("breadcrumb")} className="font-mono text-label text-muted-foreground uppercase">
          <span aria-hidden="true" className="text-primary-ink">
            {"// "}
          </span>
          {crumbs.map((crumb, i) => (
            <span key={`${i}-${crumb.label}`}>
              {i > 0 ? <span aria-hidden="true"> / </span> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Heading id={titleId} className="font-heading text-[26px] leading-[1.05] font-medium uppercase sm:text-[30px]">
            {title}
          </Heading>
          {lede ? <p className="mt-1.5 max-w-[72ch] text-sm leading-normal text-muted-foreground">{lede}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {facts ? <div className="font-mono text-label text-muted-foreground uppercase tabular-nums">{facts}</div> : null}
    </header>
  );
}
