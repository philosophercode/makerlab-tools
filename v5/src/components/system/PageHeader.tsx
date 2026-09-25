import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * One page header for every working surface (UI system spec §6.3): a mono
 * breadcrumb eyebrow ("// ADMIN / INVENTORY"), the title, an optional one-line
 * lede, a slot for the page's actions on the right, and a slot for a line of
 * facts under the title — the page's key numbers said as words.
 *
 * It replaces the admin layout's 88px "ADMIN" display heading stacked above
 * each page's own `td-eyebrow` + h2 (two headers, ~250px, before any data).
 */
export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  crumbs?: Crumb[];
  title: string;
  lede?: string;
  actions?: React.ReactNode;
  facts?: React.ReactNode;
  className?: string;
  titleId?: string;
}

export function PageHeader({ crumbs = [], title, lede, actions, facts, className, titleId }: PageHeaderProps) {
  return (
    <header className={cn("ui flex flex-col gap-2 pb-4", className)}>
      {crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="font-mono text-[11px] tracking-[0.08em] text-muted-foreground uppercase">
          <span aria-hidden="true" className="text-primary-ink">
            {"// "}
          </span>
          {crumbs.map((crumb, i) => (
            <span key={`${crumb.label}-${i}`}>
              {i > 0 ? <span aria-hidden="true"> / </span> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id={titleId} className="font-heading text-[26px] leading-[1.05] font-medium uppercase sm:text-[30px]">
            {title}
          </h2>
          {lede ? <p className="mt-1.5 max-w-[72ch] text-[14px] leading-snug text-muted-foreground">{lede}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {facts ? <div className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground uppercase">{facts}</div> : null}
    </header>
  );
}
