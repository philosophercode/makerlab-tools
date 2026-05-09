import Link from "next/link";
import type { CatalogStats } from "./catalog-types";

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
        <nav className="primary-nav" aria-label="Primary navigation">
          <Link className="is-active" href="/">
            TOOLS
          </Link>
          <a href="#">PROJECTS</a>
          <a href="#">ABOUT</a>
        </nav>
        <div className="nav-actions" aria-label="Utility controls">
          <button type="button" aria-label="Settings">
            [=]
          </button>
          <button type="button" aria-label="Account">
            [@]
          </button>
        </div>
      </header>
      <div className="status-strip" aria-label="Lab status">
        <span>
          <i className="live-dot" aria-hidden="true" /> {stats.toolsOnline} TOOLS ONLINE
        </span>
        <span>
          <i className="live-dot live-dot-secondary" aria-hidden="true" />{" "}
          {stats.awaitingTraining} AWAITING TRAINING
        </span>
        <span>{stats.labHours}</span>
      </div>
    </>
  );
}
