"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { INTAKE_POLL_INTERVAL_MS } from "../../lib/intake/limits";
import type { RefreshStatus } from "../../lib/db/schema/vocabulary";
import "../../styles/admin-refresh.css";

/**
 * `/admin/refresh`'s list (refresh research spec §5.2, §6): open refreshes and
 * failed ones, **ordered by what matters** — a safety *differs*, a safety
 * *new*, another *differs*, another *new*, then nothing to change (the page
 * sorts; `refreshRank`). Each row shows the tool, the proposal counts by kind
 * and its status, and links to the tool's review page.
 *
 * While any row is queued or researching it asks for a fresh render every few
 * seconds, like the intake queue, and stops the moment none is.
 */

export interface RefreshListRow {
  id: string;
  toolName: string;
  status: RefreshStatus;
  rank: number;
  counts: { differs: number; new: number; unverified: number; safety: number };
  researchError: string | null;
  requestedAt: string;
}

export function RefreshList({ rows }: { rows: RefreshListRow[] }) {
  const t = useTranslations("admin.refresh");
  const router = useRouter();
  const running = rows.some((row) => row.status === "queued" || row.status === "researching");

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), INTAKE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  if (rows.length === 0) return <p className="admin-empty td-empty">{t("empty")}</p>;

  return (
    <ul className="admin-refresh-list" aria-label={t("listLabel")}>
      {rows.map((row) => (
        <li key={row.id} className={`admin-refresh-row admin-refresh-rank-${row.rank}`}>
          <h3>
            <Link href={`/admin/refresh/${row.id}`}>{row.toolName}</Link>
          </h3>
          <span className={`admin-state is-${row.status === "proposed" ? "draft" : row.status}`}>{t(`status.${row.status}`)}</span>
          <p className="admin-queue-meta">
            {row.status === "proposed" ? (
              row.rank === 4 ? (
                t("nothingToChange")
              ) : (
                <>
                  {t("counts", { differs: row.counts.differs, new: row.counts.new, unverified: row.counts.unverified })}
                  {row.counts.safety > 0 ? <> · <strong>{t("safetyCount", { count: row.counts.safety })}</strong></> : null}
                </>
              )
            ) : row.status === "failed" && row.researchError ? (
              <>
                <span className="admin-intake-diagnosis-label">{t("failedLabel")}: </span>
                {row.researchError}
              </>
            ) : (
              <span className="admin-date">{row.requestedAt.slice(0, 16).replace("T", " ")}</span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
