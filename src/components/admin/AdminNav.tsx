"use client";

import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { currentSection, sectionsFor, type AdminNavItem } from "../../lib/admin/surfaces";
import { cn } from "@/lib/utils";

export type { AdminNavItem };

/**
 * The admin section bar (UI system spec §8.1; admin sections spec 2026-10-07;
 * DESIGN.md §8.12), on every admin page: `OVERVIEW · MAINTENANCE · INVENTORY ·
 * PEOPLE · INSIGHTS · SETTINGS`, then whatever the layout puts at the end
 * (**Ask MakerLAB AI**). The surfaces inside a section are the tabs under each
 * page's header (`SectionTabs`), not links here.
 *
 * **It links only what it is handed**, and the layout hands it
 * `surfacesFor(identity)`, the same `can()` each page checks. A section with
 * nothing open to the viewer is not shown, and a section's link opens the
 * first surface in it the viewer may open, so nothing here leads into a
 * refusal: a SuperMaker's People opens Student projects, a director's the
 * roster. **No counts** (owner decision 2026-09-25): waiting work is said on
 * the overview, not in a bar where it is noise on every page.
 *
 * A client island only for `usePathname`: the section of the most specific
 * surface the path is on gets `aria-current="page"` and the accent underline.
 * On a phone the bar scrolls sideways inside itself; the page never does, and
 * the current section is scrolled into the bar's view (Settings is off the
 * right edge at 390 px otherwise).
 */
export function AdminNav({ items, end }: { items: readonly AdminNavItem[]; end?: ReactNode }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname() ?? "";
  const current = currentSection(pathname, items);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = scroller.current;
    const link = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !link) return;
    // Only the bar scrolls, sideways; never the page.
    const overflowRight = link.offsetLeft + link.offsetWidth - (box.scrollLeft + box.clientWidth);
    if (overflowRight > 0) box.scrollLeft += overflowRight + 16;
    else if (link.offsetLeft < box.scrollLeft) box.scrollLeft = link.offsetLeft;
  }, [current]);

  return (
    <nav
      aria-label={t("label")}
      data-slot="admin-nav"
      className="ui -mx-4 mb-6 flex items-stretch border-y border-border px-4 sm:mx-0 sm:px-0 print:hidden"
    >
      <div ref={scroller} className="relative min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <ul className="m-0 flex min-w-max list-none items-stretch gap-x-5 p-0 font-mono text-label tracking-[0.08em] uppercase sm:gap-x-7">
          {sectionsFor(items).map(({ section, href }) => (
            <li key={section} className="flex items-center">
              <NavLink href={href} current={current === section}>
                {t(`section.${section}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
      {end ? <div className="flex shrink-0 items-center border-s border-border ps-3">{end}</div> : null}
    </nav>
  );
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex h-10 items-center border-b-2 border-transparent whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground",
        "focus-visible:outline-offset-[-2px]",
        current && "border-primary-ink text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
