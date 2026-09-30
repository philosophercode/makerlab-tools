"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DataTable } from "../system/data-table/DataTable";
import { FilterBar } from "../system/data-table/FilterBar";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { facetOptions } from "../system/data-table/facet-options";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";

/**
 * The Manuals page's starter-answer list (`/admin/research`; starter
 * answers): every starter chip — each tool's, and the general ones — with
 * whether a click answers from the cache (**Cached**), from a stale answer
 * that is no longer served (**Stale**), after an answer the grader turned
 * down (**Graded down**), or with nothing made yet (**Live**), and the grade.
 * Read-only: `npm run starters:refresh` makes and remakes the answers.
 */

export const CHIP_STATUSES = ["cached", "stale", "rejected", "live"] as const;
export type ChipStatusValue = (typeof CHIP_STATUSES)[number];

export interface StarterChipRow {
  id: string;
  toolName: string | null;
  toolSlug: string | null;
  question: string;
  status: ChipStatusValue;
  score: number | null;
  reasons: string[];
}

const TONE: Record<ChipStatusValue, StatusTone> = { cached: "ok", stale: "warn", rejected: "bad", live: "idle" };

export function StarterAnswerTable({ rows }: { rows: StarterChipRow[] }) {
  const t = useTranslations("admin.research.starters");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const statusLabel = (value: string) => t(value as ChipStatusValue);
  const searched = useMemo(() => {
    const q = query.trim();
    return q ? matchSorter(rows, q, { keys: ["question", "toolName"] }) : rows;
  }, [rows, query]);
  const shown = useMemo(() => (status ? searched.filter((row) => row.status === status) : searched), [searched, status]);

  const columns = useMemo<ColumnDef<StarterChipRow, unknown>[]>(
    () => [
      {
        id: "question",
        accessorFn: (row) => row.question,
        header: t("columnQuestion"),
        meta: { rowHeader: true, className: "min-w-64 whitespace-normal" },
        cell: ({ row }) => <span className="font-medium">{row.original.question}</span>,
      },
      {
        id: "tool",
        accessorFn: (row) => row.toolName ?? "",
        header: t("columnTool"),
        meta: { className: "whitespace-normal" },
        cell: ({ row }) =>
          row.original.toolSlug ? (
            <Link href={`/tools/${row.original.toolSlug}`} className="hover:text-primary-ink hover:underline">
              {row.original.toolName}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t("general")}</span>
          ),
      },
      {
        id: "status",
        accessorFn: (row) => CHIP_STATUSES.indexOf(row.status),
        header: t("columnStatus"),
        cell: ({ row }) => <StatusGlyph tone={TONE[row.original.status]} label={statusLabel(row.original.status)} />,
      },
      {
        id: "score",
        accessorFn: (row) => row.score ?? -1,
        header: t("columnScore"),
        sortDescFirst: true,
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.score === null ? (
            <span className="text-muted-foreground">{t("noScore")}</span>
          ) : (
            <span title={row.original.reasons.join("; ") || undefined} className="tabular-nums">
              {t("score", { score: row.original.score })}
            </span>
          ),
      },
    ],
    // `statusLabel` reads `t`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  if (rows.length === 0) return <EmptyState>{t("empty")}</EmptyState>;

  const narrowing = Boolean(query.trim() || status);
  const clear = () => {
    setQuery("");
    setStatus(null);
  };
  const filterWords = [query.trim() ? `"${query.trim()}"` : null, status ? `${t("filterStatus")}: ${statusLabel(status)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <FilterBar
        label={t("filtersLabel")}
        search={{ value: query, onChange: setQuery, label: t("search"), placeholder: t("searchPlaceholder") }}
        facets={
          <FacetFilter
            label={t("filterStatus")}
            value={status}
            options={facetOptions(searched, CHIP_STATUSES, (row, value) => row.status === value, statusLabel)}
            onChange={setStatus}
          />
        }
        activeCount={status ? 1 : 0}
        shown={shown.length}
        total={rows.length}
        onClear={narrowing ? clear : null}
      />
      <DataTable
        data={shown}
        columns={columns}
        getRowId={(row) => row.id}
        getRowName={(row) => row.question}
        labels={{ table: t("tableLabel") }}
        keyboardHint={false}
        empty={<EmptyState action={<Button onClick={clear}>{t("clearFilters")}</Button>}>{t("emptyFiltered", { filters: filterWords })}</EmptyState>}
        mobileRow={(row) => (
          <div className="flex flex-col gap-1 px-1 py-2.5">
            <p className="text-sm font-medium">{row.question}</p>
            <p className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
              <span>{row.toolName ?? t("general")}</span>
              <StatusGlyph tone={TONE[row.status]} label={statusLabel(row.status)} />
              {row.score !== null ? <span className="tabular-nums">{t("score", { score: row.score })}</span> : null}
            </p>
          </div>
        )}
      />
    </>
  );
}
