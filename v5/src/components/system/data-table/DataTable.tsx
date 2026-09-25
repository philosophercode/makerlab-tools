"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePhoneLayout } from "./use-phone-layout";

/**
 * The one data table (UI system spec §7.2; DESIGN.md §8.3).
 *
 * TanStack Table v8 holds the state — sorting, column visibility, row
 * selection — and the phase-1 `table` / `checkbox` primitives draw it, because
 * the look is the point:
 *
 * - **Dense and calm.** 13px text, ~34px rows, a `--rule` hairline between rows
 *   and nothing else. Numeric columns (`meta.align: "right"`) are
 *   right-aligned, mono and tabular, so a column of counts reads as a column.
 * - **Sticky header** under the site's sticky chrome, so a 100-row review
 *   never loses its column names. Sort state is `aria-sort` on the `th`.
 * - **Keyboard.** One row is in the tab order at a time (roving tabindex):
 *   ↑/↓ or j/k move, Home/End jump, Space or x selects, Enter activates
 *   (`onActivate`, e.g. open the editor).
 * - **Selection** with a header box over the rows *shown* and a sticky bulk
 *   bar that appears only while something is selected. Selection survives
 *   filtering — the bar says how many selected rows the filter is hiding, so a
 *   bulk action never silently includes rows the reviewer cannot see.
 * - **Phone.** Below `sm`, `mobileRow` renders each row as a two-line list
 *   item — a table squeezed into 390px is a table nobody can read. A table
 *   without `mobileRow` (a short, narrow one) stays a table and scrolls
 *   sideways inside itself.
 *
 * Filtering is **not** here: the caller filters and passes the rows in,
 * because which filters exist, and whether they live in the URL, is the
 * page's business (`FilterBar`, `inventory-filters.ts`).
 */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's name in the Columns menu (a header may be terse, or sr-only). */
    label?: string;
    /** `right` for numbers and dates: right-aligned, mono, tabular. */
    align?: "left" | "right";
    /** Extra classes for the column's header and cells (width, wrapping). */
    className?: string;
    /** Extra classes for the body cells only (e.g. `align-top` beside a multi-line cell). */
    cellClassName?: string;
    /** Render this column's cells as `<th scope="row">` — the row's name. */
    rowHeader?: boolean;
  }
}

export interface DataTableLabels {
  /** The table's accessible name ("Tools, their state and what each one is missing"). */
  table: string;
  /** "3 tools selected" — defaults to the generic "3 selected". */
  selected?: (count: number) => string;
}

export interface MobileRowState {
  selected: boolean;
  toggle: () => void;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  /** A row's name, for its checkbox's label ("Select Form 4"). */
  getRowName: (row: T) => string;
  labels: DataTableLabels;
  /** Shown instead of the table when `data` is empty — an `EmptyState` naming why. */
  empty: ReactNode;
  selectable?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (next: RowSelectionState) => void;
  /** Rendered in the sticky bar while rows are selected. */
  bulkActions?: (selectedIds: string[], clear: () => void) => ReactNode;
  onActivate?: (row: T) => void;
  /** The phone layout: one compact list item per row. Omit to keep the table. */
  mobileRow?: (row: T, state: MobileRowState) => ReactNode;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (next: VisibilityState) => void;
  initialSorting?: SortingState;
  rowClassName?: (row: T) => string | undefined;
  /** Show the keyboard hint under the table (default: when rows can be activated or selected). */
  keyboardHint?: boolean;
  /** Pin the header under the site chrome (default: when the table has a phone list, i.e. may be long). Its fill is the page background, so pass false for a table on a card. */
  stickyHeader?: boolean;
  className?: string;
}

export function DataTable<T>({
  data,
  columns,
  getRowId,
  getRowName,
  labels,
  empty,
  selectable = false,
  selection,
  onSelectionChange,
  bulkActions,
  onActivate,
  mobileRow,
  columnVisibility,
  onColumnVisibilityChange,
  initialSorting = [],
  rowClassName,
  keyboardHint,
  stickyHeader,
  className,
}: DataTableProps<T>) {
  const t = useTranslations("ui.dataTable");
  const phone = usePhoneLayout();
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [ownSelection, setOwnSelection] = useState<RowSelectionState>({});
  const rowSelection = selection ?? ownSelection;
  const setRowSelection = onSelectionChange ?? setOwnSelection;
  const [ownVisibility, setOwnVisibility] = useState<VisibilityState>({});
  const visibility = columnVisibility ?? ownVisibility;
  const setVisibility = onColumnVisibilityChange ?? setOwnVisibility;

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!selectable) return columns;
    const select: ColumnDef<T, unknown> = {
      id: "select",
      enableSorting: false,
      enableHiding: false,
      meta: { className: "w-8" },
      header: ({ table }) => (
        <Checkbox
          aria-label={t("selectAllShown")}
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={t("selectRow", { name: getRowName(row.original) })}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
          // The row is the tab stop; Space on the row selects (roving tabindex).
          tabIndex={-1}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable, getRowName, t]);

  // TanStack's hook returns functions the React Compiler cannot memoise; at a
  // few hundred rows that costs nothing (spec §11, "React Compiler").
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId: (row) => getRowId(row),
    state: { sorting, rowSelection, columnVisibility: visibility },
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) =>
      setRowSelection(typeof updater === "function" ? updater(rowSelection) : updater),
    onColumnVisibilityChange: (updater) =>
      setVisibility(typeof updater === "function" ? updater(visibility) : updater),
    enableRowSelection: selectable,
    enableSortingRemoval: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const shownIds = useMemo(() => new Set(data.map(getRowId)), [data, getRowId]);
  const hiddenSelected = selectedIds.filter((id) => !shownIds.has(id)).length;
  const clear = () => setRowSelection({});
  const current = Math.min(focusIndex, Math.max(0, rows.length - 1));

  // Keep the roving tab stop on a row that exists after the rows change.
  useEffect(() => {
    if (focusIndex > rows.length - 1 && rows.length > 0) setFocusIndex(rows.length - 1);
  }, [rows.length, focusIndex]);

  function focusRow(index: number) {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setFocusIndex(next);
    rowRefs.current[next]?.focus();
  }

  function onRowKeyDown(event: KeyboardEvent<HTMLTableRowElement>, index: number) {
    if (event.target !== event.currentTarget) return; // a control inside the row has focus
    const row = rows[index];
    switch (event.key) {
      case "ArrowDown":
      case "j":
        event.preventDefault();
        focusRow(index + 1);
        break;
      case "ArrowUp":
      case "k":
        event.preventDefault();
        focusRow(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusRow(0);
        break;
      case "End":
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case " ":
      case "x":
        if (!selectable) return;
        event.preventDefault();
        row.toggleSelected();
        break;
      case "Enter":
        if (!onActivate) return;
        event.preventDefault();
        onActivate(row.original);
        break;
    }
  }

  const selectedWord = labels.selected ?? ((count: number) => t("selected", { count }));
  const bar =
    selectable && selectedIds.length > 0 && bulkActions ? (
      <div
        role="region"
        aria-label={selectedWord(selectedIds.length)}
        // pe-20 keeps the actions clear of the chat launcher in the corner (DESIGN.md §8.13).
        className="sticky bottom-0 z-20 mt-2 flex flex-wrap items-center gap-2 border border-border bg-card py-2 ps-3 pe-20"
      >
        <span role="status" className="me-auto font-mono text-label uppercase">
          <span className="text-primary-ink tabular-nums">{selectedWord(selectedIds.length)}</span>
          {hiddenSelected > 0 ? (
            <span className="text-muted-foreground"> · {t("selectedHidden", { count: hiddenSelected })}</span>
          ) : null}
        </span>
        {bulkActions(selectedIds, clear)}
      </div>
    ) : null;

  if (data.length === 0) {
    return (
      <>
        {empty}
        {bar}
      </>
    );
  }

  // null → both, CSS decides (server render, hydration, jsdom); then only one.
  const showTable = !mobileRow || phone !== true;
  const showList = Boolean(mobileRow) && phone !== false;
  const hint = keyboardHint ?? Boolean(onActivate || selectable);
  const sticky = stickyHeader ?? Boolean(mobileRow);

  return (
    <div data-slot="data-table" className={cn("ui relative", className)}>
      {showTable ? (
        <div className={cn(mobileRow ? "hidden sm:block" : "overflow-x-auto")}>
          <table
            data-slot="table"
            aria-label={labels.table}
            className="w-full border-collapse text-table"
          >
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const meta = header.column.columnDef.meta;
                    const sorted = header.column.getIsSorted();
                    return (
                      <TableHead
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                        className={cn(
                          // Sticky only when the page scrolls the table, not a scroll box around it.
                          sticky && "sticky top-[var(--sticky-chrome-height)] z-10 bg-background",
                          "align-bottom",
                          meta?.align === "right" && "text-end",
                          meta?.className
                        )}
                      >
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-1 uppercase hover:text-foreground",
                              meta?.align === "right" && "flex-row-reverse",
                              sorted && "text-foreground"
                            )}
                          >
                            {renderSlot(header.column.columnDef.header, header.getContext())}
                            <span aria-hidden="true" className={cn("w-2 text-primary-ink", !sorted && "opacity-0")}>
                              {sorted === "desc" ? "↓" : "↑"}
                            </span>
                          </button>
                        ) : (
                          renderSlot(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </tr>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  tabIndex={index === current ? 0 : -1}
                  aria-selected={selectable ? row.getIsSelected() : undefined}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onFocus={(event) => {
                    if (event.target === event.currentTarget) setFocusIndex(index);
                  }}
                  onKeyDown={(event) => onRowKeyDown(event, index)}
                  className={cn(
                    "group/row focus-visible:bg-muted focus-visible:outline-1 focus-visible:-outline-offset-1",
                    "data-[state=selected]:bg-primary/[0.07] data-[state=selected]:hover:bg-primary/10",
                    rowClassName?.(row.original)
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta;
                    const Cell = meta?.rowHeader ? "th" : TableCell;
                    return (
                      <Cell
                        key={cell.id}
                        {...(meta?.rowHeader ? { scope: "row" } : {})}
                        className={cn(
                          "h-[34px] px-2 py-1.5 align-middle whitespace-nowrap",
                          meta?.rowHeader && "text-start font-normal",
                          meta?.align === "right" && "text-end font-mono tabular-nums",
                          meta?.className,
                          meta?.cellClassName
                        )}
                      >
                        {renderSlot(cell.column.columnDef.cell, cell.getContext())}
                      </Cell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </table>
          {hint ? (
            <p className="mt-2 font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">
              {t(selectable && onActivate ? "keyboardHint" : onActivate ? "keyboardHintOpen" : "keyboardHintSelect")}
            </p>
          ) : null}
        </div>
      ) : null}

      {showList && mobileRow ? (
        <ul aria-label={labels.table} className="border-t border-rule sm:hidden">
          {rows.map((row) => (
            <li
              key={row.id}
              data-state={row.getIsSelected() ? "selected" : undefined}
              className="min-h-10 border-b border-rule data-[state=selected]:bg-primary/[0.07]"
            >
              {mobileRow(row.original, { selected: row.getIsSelected(), toggle: () => row.toggleSelected() })}
            </li>
          ))}
        </ul>
      ) : null}

      {bar}
    </div>
  );
}

/**
 * A column's `header` / `cell`, rendered by **calling** it — not, as
 * TanStack's `flexRender` does, by mounting a function as a component. A page
 * rebuilds its column list whenever a prop it closes over changes (a server
 * action's reference is new after every server re-render), and with
 * `flexRender` each new function is a new component type: every cell
 * remounts, and a `RoleSelect` in a cell loses the "Saved" it just earned.
 * Called, the elements it returns reconcile by type and keep their state. So
 * a cell function is a render function: hooks belong in the component it
 * returns, never in the function itself.
 */
function renderSlot<P extends object>(slot: unknown, props: P): ReactNode {
  return typeof slot === "function" ? (slot as (props: P) => ReactNode)(props) : ((slot as ReactNode) ?? null);
}
