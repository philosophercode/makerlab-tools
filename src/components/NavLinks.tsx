"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Browse" },
  { href: "/scan", label: "Scan" },
  { href: "/chat", label: "Chat" },
  { href: "/report", label: "Report Issue" },
];

export default function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <>
      {/* Desktop links */}
      <div className="hidden md:flex items-center gap-6 text-sm">
        {links.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <a
              key={href}
              href={href}
              className={`transition-colors ${
                active
                  ? "font-semibold text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
              {...(active ? { "aria-current": "page" as const } : {})}
            >
              {label}
            </a>
          );
        })}
      </div>

      {/* Mobile hamburger button */}
      <button
        className="md:hidden flex items-center justify-center w-10 h-10 -mr-2 rounded-lg text-muted hover:text-foreground hover:bg-muted-bg transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {open ? (
            <>
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </>
          ) : (
            <>
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </>
          )}
        </svg>
      </button>

      {/* Mobile dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 top-14 z-40 bg-black/20 md:hidden" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-14 z-50 border-b border-card-border bg-card-bg md:hidden">
            <div className="mx-auto max-w-7xl flex flex-col py-2 px-4">
              {links.map(({ href, label }) => {
                const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
                return (
                  <a
                    key={href}
                    href={href}
                    className={`py-3 text-sm transition-colors ${
                      active
                        ? "font-semibold text-foreground"
                        : "text-muted hover:text-foreground"
                    }`}
                    {...(active ? { "aria-current": "page" as const } : {})}
                  >
                    {label}
                  </a>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
