"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  flexRender,
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

/**
 * The one data table (UI system spec §6.4, DESIGN.md "Data table").
 *
 * TanStack Table for the state (sorting, column visibility, row selection);
 * our own markup for the look, because the look is the point:
 *
 * - **Dense and calm.** 13px text, ~34px rows, hairline row rules only — no
 *   vertical rules, no zebra, no boxed cells. Numbers right-aligned and
 *   tabular (`meta.align: "right"`), so a column of counts reads as a column.
 * - **Sticky header** under the site's sticky chrome, so a 100-row review
 *   never loses its column names.
 * - **Keyboard.** One row is in the tab order at a time (roving tabindex):
 *   ↑/↓ or j/k move, Space or x selects, Enter activates (`onActivate`, e.g.
 *   open the editor), Home/End jump.
 * - **Selection** with a header checkbox over the rows shown, and a sticky
 *   bulk-action bar that appears only while something is selected.
 * - **Phone.** Below `sm` the table is replaced by `mobileRow`, a two-line
 *   list item per row — a table squeezed into 390px is a table nobody can read.
 *
 * Filtering is **not** here: the caller filters and passes the rows in, because
 * which filters exist, and whether they live in the URL, is the page's business
 * (the inventory's are links; see `inventory-filters.ts`).
 */

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** The column's name in the Columns menu (headers may be terse or icons). */
    label?: string;
    align?: "left" | "right";
    /** Tailwind width/extra classes for the column's cells. */
    className?: string;
  }
}

export interface DataTableLabels {
  table: string;
  selectAll: string;
  selectRow: (name: string) => string;
  selected: (count: number) => string;
  clearSelection: string;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  /** A row's name, for the checkbox's label ("Select Form 4"). */
  getRowName: (row: T) => string;
  labels: DataTableLabels;
  /** Shown instead of the table when `data` is empty. */
  empty: React.ReactNode;
  selectable?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (next: RowSelectionState) => void;
  /** Rendered in the sticky bar while rows are selected. */
  bulkActions?: (selectedIds: string[], clear: () => void) => React.ReactNode;
  onActivate?: (row: T) => void;
  mobileRow: (row: T, state: { selected: boolean; toggle: () => void }) => React.ReactNode;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: (next: VisibilityState) => void;
  initialSorting?: SortingState;
  rowClassName?: (row: T) => string | undefined;
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
}: DataTableProps<T>) {
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
          aria-label={labels.selectAll}
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(value) => table.toggleAllRowsSelected(value === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label={labels.selectRow(getRowName(row.original))}
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(value === true)}
          onClick={(event) => event.stopPropagation()}
          tabIndex={-1}
        />
      ),
    };
    return [select, ...columns];
  }, [columns, selectable, labels, getRowName]);

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
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rows = table.getRowModel().rows;
  const [focusIndex, setFocusIndex] = useState(0);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  const clear = () => setRowSelection({});

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

  if (data.length === 0) return <>{empty}</>;

  return (
    <div className="ui relative">
      {/* Desktop and tablet: the table. */}
      <table className="hidden w-full border-collapse text-[13px] leading-[1.35] sm:table" aria-label={labels.table}>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={cn(
                      "sticky top-[var(--sticky-chrome-height)] z-10 border-b border-border bg-background px-2 py-2 text-left align-bottom",
                      "font-mono text-[10px] font-medium tracking-[0.08em] whitespace-nowrap text-muted-foreground uppercase",
                      meta?.align === "right" && "text-right",
                      meta?.className
                    )}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 uppercase hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid",
                          sorted && "text-foreground"
                        )}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span aria-hidden="true" className={cn("w-2 text-primary-ink", !sorted && "opacity-0")}>
                          {sorted === "desc" ? "↓" : "↑"}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.id}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              tabIndex={index === focusIndex ? 0 : -1}
              aria-selected={selectable ? row.getIsSelected() : undefined}
              onFocus={() => setFocusIndex(index)}
              onKeyDown={(event) => onRowKeyDown(event, index)}
              className={cn(
                "group/row border-b border-rule outline-none hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid",
                row.getIsSelected() && "bg-primary/[0.07] hover:bg-primary/10",
                rowClassName?.(row.original)
              )}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <td
                    key={cell.id}
                    className={cn(
                      "px-2 py-[5px] align-top whitespace-nowrap",
                      meta?.align === "right" && "text-right font-mono tabular-nums",
                      meta?.className
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Phone: one compact list item per row. */}
      <ul className="m-0 list-none border-t border-rule p-0 sm:hidden" aria-label={labels.table}>
        {rows.map((row) => (
          <li key={row.id} className={cn("border-b border-rule", row.getIsSelected() && "bg-primary/[0.07]")}>
            {mobileRow(row.original, { selected: row.getIsSelected(), toggle: () => row.toggleSelected() })}
          </li>
        ))}
      </ul>

      {selectable && selectedIds.length > 0 && bulkActions ? (
        <div
          role="region"
          aria-label={`${selectedIds.length} ${labels.selected(selectedIds.length)}`}
          className="sticky bottom-0 z-20 mt-2 flex flex-wrap items-center gap-2 border border-border bg-card py-2 pr-20 pl-3"
        >
          <span role="status" className="mr-auto font-mono text-[11px] tracking-[0.06em] uppercase">
            <span className="text-primary-ink tabular-nums">{selectedIds.length}</span> {labels.selected(selectedIds.length)}
          </span>
          {bulkActions(selectedIds, clear)}
        </div>
      ) : null}
    </div>
  );
}
