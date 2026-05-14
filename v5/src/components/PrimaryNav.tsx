"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "TOOLS", match: (path: string) => path === "/" || path.startsWith("/tools") },
  { href: "/projects", label: "PROJECTS", match: (path: string) => path.startsWith("/projects") },
  { href: "/about", label: "ABOUT", match: (path: string) => path.startsWith("/about") },
];

export function PrimaryNav() {
  const pathname = usePathname() || "/";

  return (
    <nav className="primary-nav" aria-label="Primary navigation">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.match(pathname) ? "is-active" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
