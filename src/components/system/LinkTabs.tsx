"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
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
 * Imports and not also Queue, whose path is its prefix. Views of one page
 * that differ only by a query (`/admin/proposals?view=manuals`) cannot be
 * told apart by the path, so that page names the `current` href itself.
 */
export interface LinkTab {
  href: string;
  label: string;
}

export function LinkTabs({
  label,
  tabs,
  className,
  current: currentHref,
}: {
  label: string;
  tabs: readonly LinkTab[];
  className?: string;
  /** The tab you are on, when the path alone cannot say (tabs that differ by query). */
  current?: string;
}) {
  const pathname = (usePathname() ?? "").replace(/\/+$/, "");
  const current =
    currentHref ??
    tabs
      .map((tab) => tab.href)
      .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
      .sort((a, b) => b.length - a.length)[0] ??
    null;
  const scroller = useRef<HTMLElement>(null);

  // On a phone, eight Inventory tabs overflow: bring the current one into
  // view, sideways only (admin sections spec 2026-10-07).
  useEffect(() => {
    const box = scroller.current;
    const link = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !link) return;
    const overflowRight = link.offsetLeft + link.offsetWidth - (box.scrollLeft + box.clientWidth);
    if (overflowRight > 0) box.scrollLeft += overflowRight + 16;
    else if (link.offsetLeft < box.scrollLeft) box.scrollLeft = Math.max(0, link.offsetLeft - 16);
  }, [current]);

  return (
    <nav
      ref={scroller}
      aria-label={label}
      data-slot="link-tabs"
      className={cn("ui relative -mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0", className)}
    >
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
