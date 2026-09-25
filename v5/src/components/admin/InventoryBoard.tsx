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
import { FilterBar } from "../system/data-table/FilterBar";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { ColumnsMenu } from "../system/data-table/ColumnsMenu";
import { facetOptions, uniqueValues } from "../system/data-table/facet-options";
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
  type AttentionFilter,
  type InventoryFilterState,
} from "./inventory-filters";

/**
 * `/admin/inventory`'s review table (data platform spec §5.3(a); UI system
 * spec §7.3), on the shared `DataTable` and `FilterBar`.
 *
 * **The server renders every row; this narrows them in the browser.** The
 * whole inventory is a few hundred rows, so a facet costs no round trip. **The
 * filters are also in the URL** — "every tool with no manual" is work somebody
 * hands to somebody else — so the page reads `searchParams` and passes them in
 * as `initial`, and this writes them back with `history.replaceState` rather
 * than a navigation, which would re-run the server component for rows it
 * already has and push the reviewer's every keystroke onto the Back button.
 *
 * Each facet's menu counts what each value would leave given the other
 * filters; the attention flags are words in their own column (`▲ No manual ·
 * 2 open`), because a reviewer filtering by one flag still needs to see the
 * others — "no photo and no manual" is one trip to the lab, not two. The
 * editor panel opens from a row (Edit, or Enter on the row) and closes back
 * onto the table as it was; a selection goes to **Refresh research**.
 *
 * **It never invents a photo.** The catalogue falls back to a bundled image
 * named after the tool, which is right for a visitor and wrong here: "no
 * photo" means somebody has to go and take one. **Dates are ISO**, compared
 * by the two or three people who read this table.
 */

export interface InventoryBoardProps {
  rows: InventoryRow[];
  /** The filters the URL arrived with, already validated. */
  initial: InventoryFilterState;
  /** The tool editor's server actions, handed down by the page. */
  actions?: ToolEditorActions;
  /** Whether the viewer holds `tools.publish`. Presentation only. */
  canPublish?: boolean;
  /** **Refresh research**: when given, rows can be selected and sent. The action checks `tools.edit` itself. */
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

/** The plain boolean flags, in the order the words read. */
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
  // The row rather than its id, so the panel can name the tool before its own read answers.
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  // Survives filtering: narrow, tick, narrow again, tick more. The bulk bar
  // says how many ticked rows the current filter hides.
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
    // No query keeps the server's order (by name); a query ranks by match quality.
    return query ? matchSorter(faceted, query, { keys: INVENTORY_SEARCH_KEYS.slice() }) : faceted;
  }, [filters, rows]);

  const update = (patch: Partial<InventoryFilterState>) => setFilters((current) => ({ ...current, ...patch }));

  // Each facet counts over the rows every *other* filter leaves.
  const facets = useMemo(() => {
    const without = (key: keyof InventoryFilterState) =>
      rows.filter((row) => matchesFilters(row, { ...filters, [key]: null }));
    return {
      state: facetOptions(without("state"), INVENTORY_STATES, (row, v) => row.state === v, (v) => t(`state.${v}`)),
      attention: facetOptions(
        without("attention"),
        ATTENTION_FILTERS,
        (row, v) => matchesFilters(row, { ...NO_FILTERS, attention: v as AttentionFilter }),
        (v) => (v === "any" ? t("attentionAny") : t(`flags.${v}`))
      ),
      category: facetOptions(without("category"), uniqueValues(rows.map((r) => r.categoryName)), (row, v) => row.categoryName === v),
      location: facetOptions(without("location"), uniqueValues(rows.map((r) => r.room)), (row, v) => row.room === v),
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
        meta: { label: t("columnTool"), rowHeader: true, className: "min-w-56 whitespace-normal" },
        cell: ({ row }) => (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <Link href={`/tools/${row.original.slug}`} className="font-medium text-foreground hover:text-primary-ink hover:underline">
              {row.original.name}
            </Link>
            {row.original.openRefreshId ? (
              <Link
                href={`/admin/refresh/${row.original.openRefreshId}`}
                className="font-mono text-micro tracking-[0.06em] text-primary-ink uppercase hover:underline"
              >
                <Glyph tone="active" /> {t("refreshOpen")}
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
        cell: ({ row }) => <Flags row={row.original} className="text-xs" />,
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
        cell: ({ row }) => <UnitCell row={row.original} />,
      },
      {
        id: "tickets",
        accessorFn: (row) => row.openTicketCount,
        header: t("columnTickets"),
        sortDescFirst: true,
        meta: { label: t("columnTickets"), align: "right" },
        cell: ({ row }) =>
          row.original.openTicketCount === 0 ? (
            <span className="text-muted-foreground">0</span>
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
          row.original.lastReviewedAt ? isoDay(row.original.lastReviewedAt) : <span className="text-warn">{t("never")}</span>,
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
        meta: { className: "w-14 text-end" },
        cell: ({ row }) =>
          actions ? (
            <Button
              variant="ghost"
              size="xs"
              className="opacity-70 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
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
  const clearFilters = () => setFilters(NO_FILTERS);
  const emptyMessage =
    rows.length === 0 ? t("emptyInventory") : t("emptyFiltered", { filters: describeFilters(filters, t) });

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
            <FacetFilter label={t("filterState")} value={filters.state} options={facets.state} onChange={(v) => update({ state: v as ToolState | null })} />
            <FacetFilter
              label={t("filterAttention")}
              value={filters.attention}
              options={facets.attention}
              onChange={(v) => update({ attention: v as AttentionFilter | null })}
            />
            <FacetFilter label={t("filterCategory")} value={filters.category} options={facets.category} onChange={(v) => update({ category: v })} />
            <FacetFilter label={t("filterLocation")} value={filters.location} options={facets.location} onChange={(v) => update({ location: v })} />
          </>
        }
        shown={visible.length}
        total={rows.length}
        onClear={active ? clearFilters : null}
        end={<ColumnsMenu columns={columns} visibility={visibility} onChange={setVisibility} />}
      />

      <DataTable
        data={visible}
        columns={columns}
        getRowId={getRowId}
        getRowName={getRowName}
        labels={{ table: t("tableLabel"), selected: (count) => t("selectedCount", { count }) }}
        empty={
          <EmptyState action={active ? <Button onClick={clearFilters}>{t("clearFilters")}</Button> : undefined}>
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
                <Link href={`/tools/${row.slug}`} className="truncate text-sm font-medium">
                  {row.name}
                </Link>
                <StatusGlyph tone={STATE_TONE[row.state]} label={t(`state.${row.state}`)} compact />
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {[
                  row.categoryName ?? t("uncategorized"),
                  row.room ?? t("unplaced"),
                  row.unitCount && row.worstUnitStatus
                    ? `${row.unitCount} × ${t(`unitStatus.${row.worstUnitStatus}`)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <Flags row={row} className="mt-0.5 block text-label" />
            </div>
            {actions ? (
              <Button variant="quiet" size="xs" onClick={() => setEditing(row)}>
                {t("edit")}
              </Button>
            ) : null}
          </div>
        )}
      />

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
          // Keyed by the row, so switching tools tears the panel down rather
          // than showing one tool's unsaved edits over another tool's record.
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

const getRowId = (row: InventoryRow) => row.id;
const getRowName = (row: InventoryRow) => row.name;

/** The attention flags as words, in the warn ink — the reason a row is in the queue. */
function Flags({ row, className }: { row: InventoryRow; className?: string }) {
  const t = useTranslations("admin.inventory");
  const words = FLAG_ORDER.filter((flag) => row.attention[flag]).map((flag) => t(`flags.${FLAG_KEY[flag]}`));
  if (row.attention.openTickets) words.push(t("openTicketsWithCount", { count: row.openTicketCount }));
  if (words.length === 0) return null;
  return (
    <span className={className}>
      <span className="sr-only">{t("attentionLabel")}: </span>
      <Glyph tone="warn" /> <span className="text-warn">{words.join(" · ")}</span>
    </span>
  );
}

/** The unit count, with the worst unit's status as a glyph (and, for a screen reader, a word). */
function UnitCell({ row }: { row: InventoryRow }) {
  const t = useTranslations("admin.inventory");
  if (row.unitCount === 0) return <span className="text-muted-foreground">0</span>;
  const status = row.worstUnitStatus;
  return (
    <span className="inline-flex items-baseline gap-1.5" title={status ? t(`unitStatus.${status}`) : undefined}>
      {status ? <Glyph tone={UNIT_TONE[status]} /> : null}
      {row.unitCount}
      {status ? <span className="sr-only">{t(`unitStatus.${status}`)}</span> : null}
    </span>
  );
}

function Thumb({ row, label }: { row: InventoryRow; label: string }) {
  if (!row.photoUrl) {
    return (
      <span role="img" aria-label={label} className="grid size-6 place-items-center border border-dashed border-input text-micro text-muted-foreground">
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
