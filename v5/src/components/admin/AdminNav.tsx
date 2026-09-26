"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ADMIN_GROUPS, ADMIN_HOME, currentHref, type AdminGroup, type SurfaceKey } from "../../lib/admin/surfaces";
import { cn } from "@/lib/utils";

/**
 * The admin section bar (UI system spec §8.1; DESIGN.md §8.12), on every admin
 * page: Overview, then each job's surfaces behind a divider, then whatever the
 * layout puts at the end (**Ask the assistant**, phase 5b). It replaces "back to
 * /admin, then pick" as the only way between admin pages.
 *
 * **It links only what it is handed**, and the layout hands it
 * `surfacesFor(identity)` — the same `can()` each page checks — so nothing here
 * leads into a refusal. **No counts** (owner decision 2026-09-25): a waiting
 * count belongs on the home's tile, not in a bar where it is noise on every
 * page whose job it is not.
 *
 * A client island only for `usePathname`: the most specific surface the path
 * is on gets `aria-current="page"` and the accent underline, so an import page
 * is "Import a list" and not also "Intake". On a phone the bar scrolls
 * sideways inside itself; the page never does.
 */
export interface AdminNavItem {
  key: SurfaceKey;
  href: string;
  group: AdminGroup;
}

export function AdminNav({ items, end }: { items: readonly AdminNavItem[]; end?: ReactNode }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname() ?? "";
  const current = currentHref(pathname, [ADMIN_HOME, ...items.map((item) => item.href)]);

  return (
    <nav
      aria-label={t("label")}
      data-slot="admin-nav"
      className="ui -mx-4 mb-6 flex items-stretch border-y border-border px-4 sm:mx-0 sm:px-0"
    >
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <ul className="m-0 flex min-w-max list-none items-stretch gap-x-4 p-0 font-mono text-label tracking-[0.08em] uppercase">
          <li className="flex items-center">
            <NavLink href={ADMIN_HOME} current={current === ADMIN_HOME}>
              {t("overview")}
            </NavLink>
          </li>
          {ADMIN_GROUPS.map((group) => {
            const members = items.filter((item) => item.group === group);
            if (members.length === 0) return null;
            return (
              // The divider marks the job; its name is the list's accessible name.
              <li key={group} className="flex items-center border-s border-border ps-4">
                <ul aria-label={t(`group.${group}`)} className="m-0 flex list-none items-center gap-4 p-0">
                  {members.map((item) => (
                    <li key={item.key}>
                      <NavLink href={item.href} current={current === item.href}>
                        {t(`surface.${item.key}`)}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
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
