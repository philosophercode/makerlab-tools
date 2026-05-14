import Link from "next/link";
import type { CatalogStats } from "./catalog-types";
import { PrimaryNav } from "./PrimaryNav";
import { ThemeToggle } from "./ThemeToggle";

interface GlobalChromeProps {
  stats: CatalogStats;
}

export function GlobalChrome({ stats }: GlobalChromeProps) {
  return (
    <>
      <header className="top-nav">
        <Link className="brand-lockup" href="/">
          <span>MAKERLAB</span>
          <span>{"//"} CORNELL TECH</span>
        </Link>
        <PrimaryNav />
        <div className="nav-actions" aria-label="Utility controls">
          <ThemeToggle />
        </div>
      </header>
      <div className="status-strip" aria-label="Lab status">
        <span>
          <i className="live-dot" aria-hidden="true" /> {stats.toolsInInventory} TOOLS IN
          INVENTORY
        </span>
        <span>{stats.labHours}</span>
      </div>
    </>
  );
}
