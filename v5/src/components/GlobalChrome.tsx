import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CatalogStats } from "./catalog-types";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { siteConfig } from "../lib/site-config";

interface GlobalChromeProps {
  stats: CatalogStats;
}

export function GlobalChrome({ stats }: GlobalChromeProps) {
  const t = useTranslations();

  return (
    <>
      <header className="top-nav">
        <Link className="brand-lockup" href="/">
          <span>{siteConfig.name}</span>
          <span>{t("nav.brandTagline")}</span>
        </Link>
        <PrimaryNav />
        <div className="nav-actions" aria-label={t("nav.utilityControlsLabel")}>
          <LanguageSelector />
          <ThemeToggle />
        </div>
      </header>
      <div className="status-strip" aria-label={t("status.labStatusLabel")}>
        <span>
          <i className="live-dot" aria-hidden="true" />{" "}
          {t("status.toolsInInventory", { count: stats.toolsInInventory })}
        </span>
        <span>{stats.labHours}</span>
      </div>
    </>
  );
}
