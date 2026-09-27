import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CatalogStats } from "./catalog-types";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSelector } from "./LanguageSelector";
import { HeaderSearch } from "./palette/HeaderSearch";
import type { PaletteTool } from "./palette/palette-types";
import { siteConfig } from "../lib/site-config";

interface GlobalChromeProps {
  stats: CatalogStats;
  /** The published tools the ⌘K palette searches (public polish). */
  paletteTools?: readonly PaletteTool[];
}

export function GlobalChrome({ stats, paletteTools = [] }: GlobalChromeProps) {
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
          <HeaderSearch tools={paletteTools} />
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
