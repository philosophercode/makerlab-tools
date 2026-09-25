"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { ColumnDef, RowSelectionState, VisibilityState } from "@tanstack/react-table";
import type { InventoryRow, ToolState } from "../../lib/data/inventory";
import type { UnitStatus } from "../../lib/db/schema/vocabulary";
import type { QueueRefreshAction } from "../../app/admin/refresh/action-result";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "../system/data-table/DataTable";
import { ColumnsMenu, FacetFilter, FilterBar, type FacetOption } from "../system/data-table/FilterBar";
import { EmptyState } from "../system/EmptyState";
import { Glyph, StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { RefreshDialog } from "./RefreshDialog";
import { ToolEditorPanel } from "./ToolEditorPanel";
import type { ToolEditorActions } from "./tool-editor-actions";
import {
  ATTENTION_FILTERS,
  INVENTORY_SEARCH_KEYS,
  INVENTORY_STATES,
  NO_FILTERS,
  describeFilters,
  hasActiveFilters,
  matchesFilters,
  toSearchParams,
  uniqueValues,
  type AttentionFilter,
  type InventoryFilterState,
} from "./inventory-filters";

/**
 * `/admin/inventory` on the shared `DataTable` (UI system spec §6.4, the
 * spike's second prototype). Same contract as `InventoryFilters`, which it
 * replaces: the server renders every row, this narrows them in the browser,
 * the filters live in the URL (`inventory-filters.ts`, unchanged), the editor
 * panel opens over the table, and a selection can be sent to Refresh research.
 *
 * What changes is the table: ~34px rows instead of ~80px (≈2.3× the rows per
 * screen), numbers right-aligned, status as glyph + word, the attention flags
 * as words in their own column, sortable columns, a Columns menu, keyboard
 * navigation, and a two-line list on a phone instead of a 300px card per tool.
 */

export interface InventoryBoardProps {
  rows: InventoryRow[];
  initial: InventoryFilterState;
  actions?: ToolEditorActions;
  canPublish?: boolean;
  queueRefresh?: QueueRefreshAction;
}

const STATE_TONE: Record<ToolState, StatusTone> = { published: "ok", draft: "idle", archived: "muted" };

const UNIT_TONE: Record<UnitStatus, StatusTone> = {
  available: "ok",
  in_use: "active",
  under_maintenance: "warn",
  out_of_service: "bad",
  retired: "muted",
};

const FLAG_ORDER = ["noPhoto", "noManual", "neverReviewed", "floorCheck"] as const;
const FLAG_KEY: Record<(typeof FLAG_ORDER)[number], string> = {
  noPhoto: "no_photo",
  noManual: "no_manual",
  neverReviewed: "never_reviewed",
  floorCheck: "floor_check",
};

/** Hidden until asked for: useful, but not what a review runs on. */
const DEFAULT_HIDDEN: VisibilityState = { updated: false };

export function InventoryBoard({ rows, initial, actions, canPublish = true, queueRefresh }: InventoryBoardProps) {
  const t = useTranslations("admin.inventory");
  const [filters, setFilters] = useState<InventoryFilterState>(initial);
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [refreshing, setRefreshing] = useState<string[] | null>(null);
  const [visibility, setVisibility] = useState<VisibilityState>(DEFAULT_HIDDEN);

  useEffect(() => {
    const query = toSearchParams(filters).toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [filters]);

  const visible = useMemo(() => {
    const faceted = rows.filter((row) => matchesFilters(row, filters));
    const query = filters.query.trim();
    return query ? matchSorter(faceted, query, { keys: INVENTORY_SEARCH_KEYS.slice() }) : faceted;
  }, [filters, rows]);

  const update = (patch: Partial<InventoryFilterState>) => setFilters((current) => ({ ...current, ...patch }));

  // A facet's counts are what each value would leave, given every *other*
  // active filter — so the menu never offers a value that empties the table
  // without saying so.
  const facetOptions = useMemo(() => {
    const others = (key: keyof InventoryFilterState) => rows.filter((row) => matchesFilters(row, { ...filters, [key]: null }));
    const count = (base: InventoryRow[], values: string[], match: (row: InventoryRow, value: string) => boolean, label: (value: string) => string): FacetOption[] =>
      values.map((value) => ({ value, label: label(value), count: base.filter((row) => match(row, value)).length }));

    return {
      state: count(others("state"), [...INVENTORY_STATES], (row, v) => row.state === v, (v) => t(`state.${v}`)),
      category: count(others("category"), uniqueValues(rows.map((r) => r.categoryName)), (row, v) => row.categoryName === v, (v) => v),
      location: count(others("location"), uniqueValues(rows.map((r) => r.room)), (row, v) => row.room === v, (v) => v),
      attention: count(
        others("attention"),
        [...ATTENTION_FILTERS],
        (row, v) => matchesFilters(row, { ...NO_FILTERS, attention: v as AttentionFilter }),
        (v) => (v === "any" ? t("attentionAny") : t(`flags.${v}`))
      ),
    };
  }, [rows, filters, t]);

  const columns = useMemo<ColumnDef<InventoryRow, unknown>[]>(
    () => [
      {
        id: "photo",
        header: () => <span className="sr-only">{t("columnPhoto")}</span>,
        enableSorting: false,
        meta: { label: t("columnPhoto"), className: "w-8" },
        cell: ({ row }) => <Thumb row={row.original} label={t("noPhoto")} />,
      },
      {
        id: "name",
        accessorFn: (row) => row.name,
        header: t("columnTool"),
        enableHiding: false,
        meta: { label: t("columnTool"), className: "min-w-[14rem] whitespace-normal" },
        cell: ({ row }) => (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/tools/${row.original.slug}`} className="font-medium text-foreground hover:text-primary-ink hover:underline">
              {row.original.name}
            </Link>
            {row.original.openRefreshId ? (
              <Link href={`/admin/refresh/${row.original.openRefreshId}`} className="font-mono text-[10px] tracking-[0.06em] text-primary-ink uppercase hover:underline">
                ◆ {t("refreshOpen")}
              </Link>
            ) : null}
          </div>
        ),
      },
      {
        id: "attention",
        accessorFn: (row) => FLAG_ORDER.filter((flag) => row.attention[flag]).length + (row.attention.openTickets ? 1 : 0),
        header: t("columnAttention"),
        sortDescFirst: true,
        meta: { label: t("filterAttention") },
        cell: ({ row }) => <Flags row={row.original} className="text-[12px]" />,
      },
      {
        id: "category",
        accessorFn: (row) => row.categoryName ?? "",
        header: t("columnCategory"),
        meta: { label: t("columnCategory") },
        cell: ({ row }) =>
          row.original.categoryName ? (
            <span>
              {row.original.categoryName}
              {row.original.categoryGroup ? <span className="text-muted-foreground"> · {row.original.categoryGroup}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("uncategorized")}</span>
          ),
      },
      {
        id: "location",
        accessorFn: (row) => row.room ?? "",
        header: t("columnLocation"),
        meta: { label: t("columnLocation") },
        cell: ({ row }) =>
          row.original.room ? (
            <span>
              {row.original.room}
              {row.original.zone ? <span className="text-muted-foreground"> · {row.original.zone}</span> : null}
            </span>
          ) : (
            <span className="text-muted-foreground">{t("unplaced")}</span>
          ),
      },
      {
        id: "units",
        accessorFn: (row) => row.unitCount,
        header: t("columnUnits"),
        sortDescFirst: true,
        meta: { label: t("columnUnits"), align: "right" },
        cell: ({ row }) =>
          row.original.unitCount === 0 ? (
            <span className="text-muted-foreground">–</span>
          ) : (
            <span className="inline-flex items-baseline gap-1.5" title={row.original.worstUnitStatus ? t(`unitStatus.${row.original.worstUnitStatus}`) : undefined}>
              {row.original.worstUnitStatus ? <Glyph tone={UNIT_TONE[row.original.worstUnitStatus]} /> : null}
              {row.original.unitCount}
              {row.original.worstUnitStatus ? <span className="sr-only">{t(`unitStatus.${row.original.worstUnitStatus}`)}</span> : null}
            </span>
          ),
      },
      {
        id: "tickets",
        accessorFn: (row) => row.openTicketCount,
        header: t("columnTickets"),
        sortDescFirst: true,
        meta: { label: t("columnTickets"), align: "right" },
        cell: ({ row }) =>
          row.original.openTicketCount === 0 ? (
            <span className="text-muted-foreground/60">–</span>
          ) : (
            <span className="text-warn">{row.original.openTicketCount}</span>
          ),
      },
      {
        id: "state",
        accessorFn: (row) => INVENTORY_STATES.indexOf(row.state),
        header: t("columnState"),
        meta: { label: t("columnState") },
        cell: ({ row }) => <StatusGlyph tone={STATE_TONE[row.original.state]} label={t(`state.${row.original.state}`)} />,
      },
      {
        id: "reviewed",
        accessorFn: (row) => row.lastReviewedAt?.getTime() ?? 0,
        header: t("columnReviewed"),
        meta: { label: t("columnReviewed"), align: "right" },
        cell: ({ row }) =>
          row.original.lastReviewedAt ? (
            isoDay(row.original.lastReviewedAt)
          ) : (
            <span className="text-warn">{t("never")}</span>
          ),
      },
      {
        id: "updated",
        accessorFn: (row) => row.updatedAt.getTime(),
        header: t("columnUpdated"),
        meta: { label: t("columnUpdated"), align: "right" },
        cell: ({ row }) => isoDay(row.original.updatedAt),
      },
      {
        id: "actions",
        header: () => <span className="sr-only">{t("edit")}</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { className: "w-14 text-right" },
        cell: ({ row }) =>
          actions ? (
            <Button
              variant="ghost"
              size="xs"
              className="opacity-60 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
              onClick={() => setEditing(row.original)}
            >
              {t("edit")}
            </Button>
          ) : null,
      },
    ],
    [t, actions]
  );

  const active = hasActiveFilters(filters);
  const emptyMessage = rows.length === 0 ? t("emptyInventory") : t("emptyFiltered", { filters: describeFilters(filters, t) });

  const hideable = columns.filter((column) => column.enableHiding !== false && column.id);

  return (
    <>
      <FilterBar
        label={t("filtersLabel")}
        search={{
          value: filters.query,
          onChange: (query) => update({ query }),
          label: t("filterSearch"),
          placeholder: t("filterSearchPlaceholder"),
        }}
        facets={
          <>
            <FacetFilter label={t("filterState")} anyLabel={t("filterAny")} value={filters.state} options={facetOptions.state} onChange={(v) => update({ state: v as ToolState | null })} />
            <FacetFilter label={t("filterAttention")} anyLabel={t("filterAny")} value={filters.attention} options={facetOptions.attention} onChange={(v) => update({ attention: v as AttentionFilter | null })} />
            <FacetFilter label={t("filterCategory")} anyLabel={t("filterAny")} value={filters.category} options={facetOptions.category} onChange={(v) => update({ category: v })} />
            <FacetFilter label={t("filterLocation")} anyLabel={t("filterAny")} value={filters.location} options={facetOptions.location} onChange={(v) => update({ location: v })} />
          </>
        }
        count={t("showing", { shown: visible.length, total: rows.length })}
        clear={active ? { label: t("clearFilters"), onClear: () => setFilters(NO_FILTERS) } : null}
        end={
          <ColumnsMenu
            label={t("columnsMenu")}
            columns={hideable.map((column) => ({
              id: column.id as string,
              label: column.meta?.label ?? (column.id as string),
              visible: visibility[column.id as string] !== false,
            }))}
            onToggle={(id, on) => setVisibility((current) => ({ ...current, [id]: on }))}
          />
        }
      />

      <DataTable
        data={visible}
        columns={columns}
        getRowId={(row) => row.id}
        getRowName={(row) => row.name}
        labels={{
          table: t("tableLabel"),
          selectAll: t("selectAllShown"),
          selectRow: (name) => t("selectRow", { name }),
          selected: (count) => t("selectedWord", { count }),
          clearSelection: t("clearSelection"),
        }}
        empty={
          <EmptyState action={active ? <Button onClick={() => setFilters(NO_FILTERS)}>{t("clearFilters")}</Button> : undefined}>
            {emptyMessage}
          </EmptyState>
        }
        selectable={Boolean(queueRefresh)}
        selection={selection}
        onSelectionChange={setSelection}
        columnVisibility={visibility}
        onColumnVisibilityChange={setVisibility}
        onActivate={actions ? setEditing : undefined}
        rowClassName={(row) => (row.state === "archived" ? "text-muted-foreground" : undefined)}
        bulkActions={(ids, clear) => (
          <>
            {queueRefresh ? (
              <Button variant="default" size="sm" onClick={() => setRefreshing(ids)}>
                {t("refreshSelected", { count: ids.length })}
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={clear}>
              {t("clearSelection")}
            </Button>
          </>
        )}
        mobileRow={(row, { selected, toggle }) => (
          <div className="flex items-start gap-3 px-1 py-2.5">
            {queueRefresh ? (
              <Checkbox className="mt-0.5" checked={selected} onCheckedChange={toggle} aria-label={t("selectRow", { name: row.name })} />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={`/tools/${row.slug}`} className="truncate text-[14px] font-medium">
                  {row.name}
                </Link>
                <StatusGlyph tone={STATE_TONE[row.state]} label={t(`state.${row.state}`)} compact />
              </div>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                {[row.categoryName, row.room, row.unitCount ? `${row.unitCount} × ${row.worstUnitStatus ? t(`unitStatus.${row.worstUnitStatus}`) : ""}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Flags row={row} className="mt-0.5 text-[11px]" />
            </div>
            {actions ? (
              <Button variant="quiet" size="xs" onClick={() => setEditing(row)}>
                {t("edit")}
              </Button>
            ) : null}
          </div>
        )}
      />

      <p className="mt-2 hidden font-mono text-[10px] tracking-[0.06em] text-muted-foreground uppercase sm:block">{t("keyboardHint")}</p>

      {queueRefresh && refreshing ? (
        <RefreshDialog
          toolIds={refreshing}
          action={queueRefresh}
          onClose={() => setRefreshing(null)}
          onQueued={() => setSelection({})}
        />
      ) : null}

      {actions && editing ? (
        <ToolEditorPanel
          key={editing.id}
          idOrSlug={editing.id}
          toolName={editing.name}
          actions={actions}
          canPublish={canPublish}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

/** The attention flags as words, in the warn ink — the reason a row is in the queue. */
function Flags({ row, className }: { row: InventoryRow; className?: string }) {
  const t = useTranslations("admin.inventory");
  const words = FLAG_ORDER.filter((flag) => row.attention[flag]).map((flag) => t(`flags.${FLAG_KEY[flag]}`));
  if (row.attention.openTickets) words.push(t("openTicketsWithCount", { count: row.openTicketCount }));
  if (words.length === 0) return null;
  return (
    <span className={className}>
      <span className="sr-only">{t("attentionLabel")}: </span>
      <Glyph tone="warn" />
      <span className="text-warn">{words.join(" · ")}</span>
    </span>
  );
}

function Thumb({ row, label }: { row: InventoryRow; label: string }) {
  if (!row.photoUrl) {
    return (
      <span role="img" aria-label={label} className="grid size-6 place-items-center border border-dashed border-border text-[10px] text-muted-foreground">
        +
      </span>
    );
  }
  return (
    <span className="relative block size-6 overflow-hidden border border-border bg-muted">
      <Image src={row.photoUrl} alt="" fill sizes="24px" style={{ objectFit: "cover" }} unoptimized />
    </span>
  );
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
