"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { ColumnDef } from "@tanstack/react-table";
import {
  MANUAL_LIBRARY_STATES,
  type ManualLibraryRow,
  type ManualLibraryState,
} from "../../lib/data/manual-library";
import type { ReprocessManualAction } from "../../app/admin/research/action-result";
import { Button } from "@/components/ui/button";
import { AsyncButton } from "../system/AsyncButton";
import { DataTable } from "../system/data-table/DataTable";
import { FilterBar } from "../system/data-table/FilterBar";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { facetOptions } from "../system/data-table/facet-options";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";

/**
 * The Manuals page's list (`/admin/research`; public polish): every current
 * manual PDF on the shared `DataTable`, with a search and a **State** facet
 * (Searchable / Text stored / No text / Failed / Processing) whose menu counts
 * each value, and **Re-process** on each row as an `AsyncButton` — the state
 * lives in the button, and a refusal's reason on its line.
 *
 * The filters stay in the page (a library of a few hundred manuals is worked,
 * not linked). The row's tool links to the tool page, where the editor is.
 */

export const MANUAL_STATE_TONE: Record<ManualLibraryState, StatusTone> = {
  searchable: "ok",
  textOnly: "idle",
  noText: "warn",
  failed: "bad",
  processing: "idle",
};

export function ManualLibrary({ rows, reprocess }: { rows: ManualLibraryRow[]; reprocess: ReprocessManualAction }) {
  const t = useTranslations("admin.research");
  const tErrors = useTranslations("admin.errors");
  const tReason = useTranslations("admin.inventory.editor.manualState.reasons");
  const [query, setQuery] = useState("");
  const [state, setState] = useState<string | null>(null);

  const stateLabel = (value: string) => t(value as ManualLibraryState);
  const searched = useMemo(() => {
    const q = query.trim();
    return q ? matchSorter(rows, q, { keys: ["title", "toolName"] }) : rows;
  }, [rows, query]);
  const shown = useMemo(() => (state ? searched.filter((row) => row.state === state) : searched), [searched, state]);

  const run = async (row: ManualLibraryRow) => {
    try {
      const result = await reprocess({ resourceId: row.resourceId });
      return result.ok ? true : tErrors(result.error);
    } catch {
      return tErrors("failed");
    }
  };

  const columns = useMemo<ColumnDef<ManualLibraryRow, unknown>[]>(
    () => [
      {
        id: "title",
        accessorFn: (row) => row.title,
        header: t("columnManual"),
        meta: { rowHeader: true, className: "min-w-56 whitespace-normal" },
        cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
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
            <span className="text-muted-foreground">{t("noTool")}</span>
          ),
      },
      {
        id: "state",
        accessorFn: (row) => MANUAL_LIBRARY_STATES.indexOf(row.state),
        header: t("columnState"),
        cell: ({ row }) => <StateCell row={row.original} reason={(code) => tReason(reasonKey(code))} />,
      },
      {
        id: "pages",
        accessorFn: (row) => row.pageCount ?? -1,
        header: t("columnPages"),
        sortDescFirst: true,
        meta: { align: "right" },
        cell: ({ row }) => (row.original.pageCount === null ? <span className="text-muted-foreground">–</span> : row.original.pageCount),
      },
      {
        id: "passages",
        accessorFn: (row) => row.passages,
        header: t("columnPassages"),
        sortDescFirst: true,
        meta: { align: "right" },
        cell: ({ row }) => <span className={row.original.passages === 0 ? "text-muted-foreground" : undefined}>{row.original.passages}</span>,
      },
      {
        id: "processed",
        accessorFn: (row) => row.processedAt?.getTime() ?? 0,
        header: t("columnProcessed"),
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.processedAt ? isoDay(row.original.processedAt) : <span className="text-muted-foreground">–</span>,
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("reprocess")}</span>,
        enableSorting: false,
        meta: { className: "w-32 text-end" },
        cell: ({ row }) => (
          <AsyncButton
            size="xs"
            variant="ghost"
            aria-label={t("reprocessFor", { title: row.original.title })}
            doneLabel={t("reprocessDone")}
            doneMessage={t("reprocessQueued", { title: row.original.title })}
            wrapperClassName="justify-end"
            onRun={() => run(row.original)}
          >
            {t("reprocess")}
          </AsyncButton>
        ),
      },
    ],
    // `run` closes over the action, which is stable for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, tReason]
  );

  if (rows.length === 0) return <EmptyState>{t("empty")}</EmptyState>;

  const narrowing = Boolean(query.trim() || state);
  const clear = () => {
    setQuery("");
    setState(null);
  };
  const filterWords = [query.trim() ? `"${query.trim()}"` : null, state ? `${t("filterState")}: ${stateLabel(state)}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <FilterBar
        label={t("filtersLabel")}
        search={{ value: query, onChange: setQuery, label: t("search"), placeholder: t("searchPlaceholder") }}
        facets={
          <FacetFilter
            label={t("filterState")}
            value={state}
            options={facetOptions(searched, MANUAL_LIBRARY_STATES, (row, value) => row.state === value, stateLabel)}
            onChange={setState}
          />
        }
        activeCount={state ? 1 : 0}
        shown={shown.length}
        total={rows.length}
        onClear={narrowing ? clear : null}
      />
      <DataTable
        data={shown}
        columns={columns}
        getRowId={(row) => row.id}
        getRowName={(row) => row.title}
        labels={{ table: t("tableLabel") }}
        keyboardHint={false}
        empty={
          <EmptyState action={<Button onClick={clear}>{t("clearFilters")}</Button>}>{t("emptyFiltered", { filters: filterWords })}</EmptyState>
        }
        mobileRow={(row) => (
          <div className="flex items-start gap-3 px-1 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{row.title}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                <span>{row.toolName ?? t("noTool")}</span>
                {row.pageCount !== null ? <span className="tabular-nums">{t("columnPages")}: {row.pageCount}</span> : null}
              </p>
              <StateCell row={row} reason={(code) => tReason(reasonKey(code))} />
            </div>
            <AsyncButton
              size="xs"
              variant="quiet"
              aria-label={t("reprocessFor", { title: row.title })}
              doneLabel={t("reprocessDone")}
              doneMessage={t("reprocessQueued", { title: row.title })}
              onRun={() => run(row)}
            >
              {t("reprocess")}
            </AsyncButton>
          </div>
        )}
      />
    </>
  );
}

function StateCell({ row, reason }: { row: ManualLibraryRow; reason: (code: string | null) => string }) {
  const t = useTranslations("admin.research");
  const label = row.state === "failed" ? t("failedReason", { reason: reason(row.reason) }) : t(row.state);
  return <StatusGlyph tone={MANUAL_STATE_TONE[row.state]} label={label} />;
}

/** The stored reason as a message key; anything unrecognised reads as "unreadable". */
function reasonKey(reason: string | null): "encrypted" | "corrupt" | "too_large" {
  return reason === "encrypted" || reason === "too_large" ? reason : "corrupt";
}

function isoDay(at: Date): string {
  return new Date(at).toISOString().slice(0, 10);
}
