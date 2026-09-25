"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AdminGroup } from "../../lib/admin/surfaces";
import { cn } from "@/lib/utils";

/**
 * The admin section bar (UI system spec §7.2): Overview, then each job group
 * with its surfaces, one line. Replaces "back to /admin, then pick" as the
 * only way between admin pages.
 *
 * The page hands down only the surfaces the viewer's permissions open (the
 * same `can()` the pages call), so nothing here links into a refusal. A client
 * island only for `usePathname`, to mark where you are with `aria-current`.
 *
 * On a phone the bar scrolls sideways inside itself — the page never does.
 */
export interface AdminNavItem {
  key: string;
  href: string;
  group: AdminGroup;
}

export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const t = useTranslations("admin.nav");
  const pathname = usePathname() ?? "";
  const groups = Array.from(new Set(items.map((item) => item.group)));

  // The longest href that contains this path wins, so an import page marks
  // "Import a list" and not also "Intake", whose path is its prefix.
  const current =
    items
      .map((item) => item.href)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0] ?? (pathname === "/admin" ? "/admin" : null);
  const isCurrent = (href: string) => href === current;

  return (
    <nav
      aria-label={t("label")}
      className="ui -mx-4 mb-6 overflow-x-auto border-y border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0"
    >
      <ul className="m-0 flex min-w-max list-none items-stretch gap-x-4 p-0 font-mono text-[11px] tracking-[0.08em] uppercase">
        <li className="flex items-center">
          <NavLink href="/admin" current={isCurrent("/admin")}>
            {t("overview")}
          </NavLink>
        </li>
        {groups.map((group) => (
          // The divider marks the group; its name is the list's accessible
          // name, and shown only where the bar has room for it.
          <li key={group} className="flex items-center gap-3 border-l border-border pl-4">
            <span aria-hidden="true" className="hidden text-muted-foreground/60 2xl:inline">
              {t(`group.${group}`)}
            </span>
            <ul aria-label={t(`group.${group}`)} className="m-0 flex list-none items-center gap-4 p-0">
              {items
                .filter((item) => item.group === group)
                .map((item) => (
                  <li key={item.key}>
                    <NavLink href={item.href} current={isCurrent(item.href)}>
                      {t(`surface.${item.key}`)}
                    </NavLink>
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NavLink({ href, current, children }: { href: string; current: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "inline-flex h-10 items-center border-b-2 border-transparent text-muted-foreground transition-colors hover:text-foreground",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring focus-visible:outline-solid",
        current && "border-primary-ink text-foreground"
      )}
    >
      {children}
    </Link>
  );
}
