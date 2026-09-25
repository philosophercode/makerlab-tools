"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { InventoryRow } from "../../lib/data/inventory";
import type { QueueRefreshAction } from "../../app/admin/refresh/action-result";
import { InventoryTable } from "./InventoryTable";
import { RefreshDialog } from "./RefreshDialog";
import { ToolEditorPanel } from "./ToolEditorPanel";
import type { ToolEditorActions } from "./tool-editor-actions";
import {
  ATTENTION_FILTERS,
  INVENTORY_STATES,
  NO_FILTERS,
  hasActiveFilters,
  matchesFilters,
  toSearchParams,
  type AttentionFilter,
  type InventoryFilterState,
} from "./inventory-filters";

/**
 * The filter console on `/admin/inventory` (spec §5.3(a)2).
 *
 * **The server renders every row; this narrows them in the browser** — the
 * `GalleryShell` idiom. The whole inventory is a few hundred rows, so filtering
 * is instant, the page costs one round trip, and a reviewer changing their mind
 * about a facet does not wait for a query. The table it renders is an ordinary
 * component with no data access of its own.
 *
 * **The filters are also in the URL** (§5.3(a) as briefed): "every tool with no
 * manual" is work somebody hands to somebody else, so the view has to be
 * linkable. The page reads `searchParams` and passes them in as `initial`;
 * this writes them back with `history.replaceState` rather than a router
 * navigation, because a navigation would re-run the server component to show
 * rows it already has, and `replaceState` keeps the Back button pointing at
 * wherever the reviewer came from instead of at their own last keystroke.
 */

export interface InventoryFiltersProps {
  rows: InventoryRow[];
  /** The filters the URL arrived with, already validated. */
  initial: InventoryFilterState;
  /**
   * The tool editor's server actions, handed down by the page (§5.3(3)).
   *
   * This island owns the panel because it owns the rows: selecting a row is a
   * filtering surface's own state, and putting it here is what lets the panel
   * close back onto the table exactly as the reviewer left it.
   */
  actions?: ToolEditorActions;
  /** Whether the viewer holds `tools.publish`. Presentation only; §8. */
  canPublish?: boolean;
  /**
   * **Refresh research** (refresh research spec §5.1): when given, rows get
   * checkboxes and the selection can be sent to research again. The action
   * checks `tools.edit` itself.
   */
  queueRefresh?: QueueRefreshAction;
}

/**
 * Ranked, typo-tolerant search keys, weighted by key order the way the
 * gallery's are: the name first, then where the tool sits, then its slug —
 * which is here because a reviewer arriving from a link has a slug in hand.
 */
const SEARCH_KEYS: ReadonlyArray<(row: InventoryRow) => string> = [
  (row) => row.name,
  // The official name, with its model or part number (tool display names spec §5.6).
  (row) => row.officialName ?? "",
  (row) => row.categoryName ?? "",
  (row) => row.categoryGroup ?? "",
  (row) => row.room ?? "",
  (row) => row.zone ?? "",
  (row) => row.slug,
];

export function InventoryFilters({
  rows,
  initial,
  actions,
  canPublish = true,
  queueRefresh,
}: InventoryFiltersProps) {
  const t = useTranslations("admin.inventory");
  const [filters, setFilters] = useState<InventoryFilterState>(initial);
  // Which row has the editor open, or null. The row rather than its id, so the
  // panel can name the tool before its own read has answered.
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  // The tools ticked for **Refresh research**, by id; survives filtering, so a
  // reviewer can narrow, tick, narrow again and tick more.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);

  function toggle(row: InventoryRow) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  useEffect(() => {
    const query = toSearchParams(filters).toString();
    window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
  }, [filters]);

  // Facet options come from the rows on the page, not from the whole taxonomy:
  // offering a category no tool is in is offering an empty table.
  const categories = useMemo(() => unique(rows.map((row) => row.categoryName)), [rows]);
  const locations = useMemo(() => unique(rows.map((row) => row.room)), [rows]);

  const visible = useMemo(() => {
    const faceted = rows.filter((row) => matchesFilters(row, filters));
    const query = filters.query.trim();
    // No query keeps the server's order (by name); a query replaces it with
    // match quality, which is the order somebody typing expects.
    return query ? matchSorter(faceted, query, { keys: SEARCH_KEYS.slice() }) : faceted;
  }, [filters, rows]);

  const active = hasActiveFilters(filters);

  function update(patch: Partial<InventoryFilterState>) {
    setFilters((current) => ({ ...current, ...patch }));
  }

  // Which filter is hiding everything, named (spec §6: an empty state says what
  // is missing). Composed from the active facets rather than a single "no
  // results", because the reviewer's next move is to drop one of them.
  const summary = describeFilters(filters, t);
  const emptyMessage =
    rows.length === 0 ? t("emptyInventory") : t("emptyFiltered", { filters: summary });

  return (
    <>
      <div className="admin-filters" role="search" aria-label={t("filtersLabel")}>
        <label className="admin-filter">
          <span>{t("filterSearch")}</span>
          <input
            type="search"
            value={filters.query}
            placeholder={t("filterSearchPlaceholder")}
            onChange={(event) => update({ query: event.target.value })}
          />
        </label>

        <label className="admin-filter">
          <span>{t("filterState")}</span>
          <select
            value={filters.state ?? ""}
            onChange={(event) =>
              update({ state: (event.target.value || null) as InventoryFilterState["state"] })
            }
          >
            <option value="">{t("filterAny")}</option>
            {INVENTORY_STATES.map((state) => (
              <option key={state} value={state}>
                {t(`state.${state}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-filter">
          <span>{t("filterCategory")}</span>
          <select
            value={filters.category ?? ""}
            onChange={(event) => update({ category: event.target.value || null })}
          >
            <option value="">{t("filterAny")}</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-filter">
          <span>{t("filterLocation")}</span>
          <select
            value={filters.location ?? ""}
            onChange={(event) => update({ location: event.target.value || null })}
          >
            <option value="">{t("filterAny")}</option>
            {locations.map((location) => (
              <option key={location} value={location}>
                {location}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-filter">
          <span>{t("filterAttention")}</span>
          <select
            value={filters.attention ?? ""}
            onChange={(event) =>
              update({ attention: (event.target.value || null) as AttentionFilter | null })
            }
          >
            <option value="">{t("filterAny")}</option>
            {ATTENTION_FILTERS.map((flag) => (
              <option key={flag} value={flag}>
                {flag === "any" ? t("attentionAny") : t(`flags.${flag}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-filter-actions">
          <p className="admin-filter-count" role="status">
            {t("showing", { shown: visible.length, total: rows.length })}
          </p>
          {active ? (
            <button type="button" className="admin-filter-clear" onClick={() => setFilters(NO_FILTERS)}>
              {t("clearFilters")}
            </button>
          ) : null}
        </div>
      </div>

      {queueRefresh ? (
        <div className="admin-refresh-bar">
          <button
            type="button"
            className="admin-button"
            onClick={() => setSelected((current) => new Set([...current, ...visible.map((row) => row.id)]))}
            disabled={visible.length === 0}
          >
            {t("selectAllShown")}
          </button>
          {selected.size > 0 ? (
            <>
              <span role="status">{t("selectedCount", { count: selected.size })}</span>
              <button type="button" className="admin-button" onClick={() => setSelected(new Set())}>
                {t("clearSelection")}
              </button>
              <button type="button" className="admin-button is-primary" onClick={() => setRefreshing(true)}>
                {t("refreshSelected", { count: selected.size })}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {queueRefresh && refreshing ? (
        <RefreshDialog
          toolIds={[...selected]}
          action={queueRefresh}
          onClose={() => setRefreshing(false)}
          onQueued={() => setSelected(new Set())}
        />
      ) : null}

      <InventoryTable
        rows={visible}
        emptyMessage={emptyMessage}
        onEdit={actions ? setEditing : undefined}
        selected={selected}
        onToggle={queueRefresh ? toggle : undefined}
      />

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

/** The active filters as one readable phrase, each part translated. */
function describeFilters(
  filters: InventoryFilterState,
  t: (key: string, values?: Record<string, string>) => string
): string {
  const parts: string[] = [];
  const part = (label: string, value: string) =>
    parts.push(t("filterSummaryPart", { label, value }));

  if (filters.query.trim()) part(t("filterSearch"), filters.query.trim());
  if (filters.state) part(t("filterState"), t(`state.${filters.state}`));
  if (filters.category) part(t("filterCategory"), filters.category);
  if (filters.location) part(t("filterLocation"), filters.location);
  if (filters.attention) {
    part(
      t("filterAttention"),
      filters.attention === "any" ? t("attentionAny") : t(`flags.${filters.attention}`)
    );
  }
  return parts.join(", ");
}

/** The non-null values, deduplicated and sorted — a facet's option list. */
function unique(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();
}
