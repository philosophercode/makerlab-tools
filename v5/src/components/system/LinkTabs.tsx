"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * Tabs that are pages (UI system spec §8.1; DESIGN.md §8.12): one route group's
 * views under one header — Add equipment's Queue · Imports · Import a list.
 *
 * **Links, not `role="tab"`.** Each tab is its own URL, loaded by navigation,
 * so it is a `nav` of links with `aria-current="page"` on the one you are on —
 * what a screen reader expects of navigation. `role="tab"` promises a panel
 * swapped in place with arrow-key movement, which a page load is not. The
 * look is the section bar's: mono labels, the current one underlined in the
 * accent ink, scrolling sideways inside itself on a phone.
 *
 * The longest href the path is on wins, so `/admin/intake/imports` is
 * Imports and not also Queue, whose path is its prefix.
 */
export interface LinkTab {
  href: string;
  label: string;
}

export function LinkTabs({ label, tabs, className }: { label: string; tabs: readonly LinkTab[]; className?: string }) {
  const pathname = (usePathname() ?? "").replace(/\/+$/, "");
  const current =
    tabs
      .map((tab) => tab.href)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null;

  return (
    <nav aria-label={label} data-slot="link-tabs" className={cn("ui -mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0", className)}>
      <ul className="m-0 flex min-w-max list-none gap-5 border-b border-border p-0 font-mono text-label tracking-[0.08em] uppercase">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.href === current ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-9 items-center border-b-2 border-transparent whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:text-foreground",
                "focus-visible:outline-offset-[-2px]",
                tab.href === current && "border-primary-ink text-foreground"
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
