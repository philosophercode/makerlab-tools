"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useChatLauncher } from "./ChatLauncherContext";

const LINKS = [
  { href: "/", key: "tools", match: (path: string) => path === "/" || path.startsWith("/tools") },
  { href: "/projects", key: "projects", match: (path: string) => path.startsWith("/projects") },
  { href: "/about", key: "about", match: (path: string) => path.startsWith("/about") },
] as const;

export function PrimaryNav() {
  const pathname = usePathname() || "/";
  const t = useTranslations("nav");
  const { open } = useChatLauncher();

  return (
    <nav className="primary-nav" aria-label={t("primaryNavLabel")}>
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={link.match(pathname) ? "is-active" : undefined}
        >
          {t(link.key)}
        </Link>
      ))}
      <button
        type="button"
        className="primary-nav-report"
        onClick={() => open(t("reportSeed"))}
        aria-label={t("reportAria")}
      >
        {t("report")}
      </button>
    </nav>
  );
}
