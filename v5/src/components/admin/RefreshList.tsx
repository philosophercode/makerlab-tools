"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { INTAKE_POLL_INTERVAL_MS } from "../../lib/intake/limits";
import type { RefreshStatus } from "../../lib/db/schema/vocabulary";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";

/**
 * `/admin/refresh`'s list (refresh research spec §5.2, §6) as a `DataTable`:
 * open refreshes and failed ones, **ordered by what matters** — a safety
 * *differs*, a safety *new*, another *differs*, another *new*, then nothing to
 * change (the page sorts; `refreshRank`). The proposal counts are numbers in
 * their own right-aligned columns, so "which one has the most to decide" is a
 * glance down a column; a header re-sorts, and the page's order comes back
 * when the sort is cleared.
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

const STATUS_TONE: Record<RefreshStatus, StatusTone> = {
  queued: "idle",
  researching: "idle",
  proposed: "active",
  failed: "bad",
  decided: "muted",
};

export function RefreshList({ rows }: { rows: RefreshListRow[] }) {
  const t = useTranslations("admin.refresh");
  const router = useRouter();
  const running = rows.some((row) => row.status === "queued" || row.status === "researching");

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), INTAKE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  const columns = useMemo<ColumnDef<RefreshListRow, unknown>[]>(() => {
    const count = (id: "differs" | "new" | "unverified" | "safety", header: string): ColumnDef<RefreshListRow, unknown> => ({
      id,
      accessorFn: (row) => row.counts[id],
      header,
      sortDescFirst: true,
      meta: { align: "right" },
      cell: ({ row }) =>
        row.original.status !== "proposed" ? (
          <span className="text-muted-foreground">–</span>
        ) : row.original.counts[id] === 0 ? (
          <span className="text-muted-foreground">0</span>
        ) : (
          <span className={id === "safety" ? "text-bad" : undefined}>{row.original.counts[id]}</span>
        ),
    });
    return [
      {
        id: "tool",
        accessorFn: (row) => row.toolName,
        header: t("columnTool"),
        meta: { rowHeader: true, className: "whitespace-normal" },
        cell: ({ row }) => (
          <Link href={`/admin/refresh/${row.original.id}`} className="font-medium hover:text-primary-ink hover:underline">
            {row.original.toolName}
          </Link>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.rank,
        header: t("columnStatus"),
        cell: ({ row }) => <StatusGlyph tone={STATUS_TONE[row.original.status]} label={t(`status.${row.original.status}`)} />,
      },
      count("safety", t("columnSafety")),
      count("differs", t("columnDiffers")),
      count("new", t("columnNew")),
      count("unverified", t("columnUnverified")),
      {
        id: "note",
        header: t("columnNote"),
        enableSorting: false,
        meta: { className: "w-full whitespace-normal" },
        cell: ({ row }) => <Note row={row.original} />,
      },
      {
        id: "requested",
        accessorFn: (row) => row.requestedAt,
        header: t("columnRequested"),
        meta: { align: "right" },
        cell: ({ row }) => row.original.requestedAt.slice(0, 16).replace("T", " "),
      },
    ];
  }, [t]);

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={getRowId}
      getRowName={getRowName}
      labels={{ table: t("listLabel") }}
      empty={<EmptyState>{t("empty")}</EmptyState>}
      onActivate={(row) => router.push(`/admin/refresh/${row.id}`)}
      mobileRow={(row) => (
        <div className="flex flex-col gap-0.5 px-1 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/admin/refresh/${row.id}`} className="truncate text-sm font-medium">
              {row.toolName}
            </Link>
            <StatusGlyph tone={STATUS_TONE[row.status]} label={t(`status.${row.status}`)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {row.status === "proposed" && row.rank !== 4 ? (
              <>
                {t("counts", { differs: row.counts.differs, new: row.counts.new, unverified: row.counts.unverified })}
                {row.counts.safety > 0 ? <strong className="text-bad"> · {t("safetyCount", { count: row.counts.safety })}</strong> : null}
              </>
            ) : (
              <Note row={row} />
            )}
          </p>
        </div>
      )}
    />
  );
}

const getRowId = (row: RefreshListRow) => row.id;
const getRowName = (row: RefreshListRow) => row.toolName;

/** What the numbers cannot say: nothing to change, or why it failed. */
function Note({ row }: { row: RefreshListRow }) {
  const t = useTranslations("admin.refresh");
  if (row.status === "proposed" && row.rank === 4) return <span className="text-muted-foreground">{t("nothingToChange")}</span>;
  if (row.status === "failed" && row.researchError) {
    return (
      <span>
        <span className="text-muted-foreground">{t("failedLabel")}: </span>
        {row.researchError}
      </span>
    );
  }
  return null;
}
