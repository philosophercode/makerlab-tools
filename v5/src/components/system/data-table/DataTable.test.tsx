import { useState } from "react";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import { render, screen, userEvent, within } from "../../../../test/utils/render";
import { DataTable, type DataTableProps } from "./DataTable";
import { facetOptions, uniqueValues } from "./facet-options";

/**
 * The shared table (UI system spec §7.2, §14): sorting and `aria-sort` on the
 * header cell, selection and its bulk bar (including selected rows a filter
 * hides), the roving-tabindex keyboard, the phone list, and the empty state.
 */

interface Row {
  id: string;
  name: string;
  count: number;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", count: 3 },
  { id: "b", name: "Bravo", count: 10 },
  { id: "c", name: "Charlie", count: 1 },
];

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { id: "name", accessorFn: (r) => r.name, header: "Name", meta: { rowHeader: true }, cell: ({ row }) => row.original.name },
  { id: "count", accessorFn: (r) => r.count, header: "Count", meta: { align: "right" }, sortDescFirst: true },
];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  return render(
    <DataTable<Row>
      data={ROWS}
      columns={COLUMNS}
      getRowId={(r) => r.id}
      getRowName={(r) => r.name}
      labels={{ table: "Things" }}
      empty={<p>Nothing here because of the filter.</p>}
      mobileRow={(r) => <span>{r.name} on a phone</span>}
      {...props}
    />
  );
}

function table() {
  return screen.getByRole("table", { name: "Things" });
}

function bodyNames(): string[] {
  return within(table())
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent ?? "");
}

it("sorts by a header, and says which way on the header cell — not on the button", async () => {
  renderTable();
  expect(bodyNames()).toEqual(["Alpha", "Bravo", "Charlie"]);
  expect(screen.getByRole("columnheader", { name: /Count/ })).not.toHaveAttribute("aria-sort");

  await userEvent.click(screen.getByRole("button", { name: /Count/ }));
  expect(bodyNames()).toEqual(["Bravo", "Alpha", "Charlie"]);
  expect(screen.getByRole("columnheader", { name: /Count/ })).toHaveAttribute("aria-sort", "descending");
  expect(screen.getByRole("button", { name: /Count/ })).not.toHaveAttribute("aria-sort");

  await userEvent.click(screen.getByRole("button", { name: /Count/ }));
  expect(screen.getByRole("columnheader", { name: /Count/ })).toHaveAttribute("aria-sort", "ascending");
});

it("names each row by its row header, and right-aligns a numeric column", () => {
  renderTable();
  const bravo = within(table()).getByRole("row", { name: /Bravo/ });
  expect(within(bravo).getByRole("rowheader")).toHaveAttribute("scope", "row");
  expect(within(bravo).getByRole("cell").className).toMatch(/text-end/);
  expect(within(bravo).getByRole("cell").className).toMatch(/tabular-nums/);
});

it("selects rows and offers the bulk actions only while something is selected", async () => {
  const bulk = vi.fn();
  renderTable({
    selectable: true,
    bulkActions: (ids, clear) => (
      <>
        <button type="button" onClick={() => bulk(ids)}>
          Do it
        </button>
        <button type="button" onClick={clear}>
          Clear
        </button>
      </>
    ),
  });
  expect(screen.queryByRole("button", { name: "Do it" })).not.toBeInTheDocument();

  await userEvent.click(within(table()).getByRole("checkbox", { name: "Select Bravo" }));
  await userEvent.click(within(table()).getByRole("checkbox", { name: "Select Charlie" }));
  expect(screen.getByRole("region", { name: "2 selected" })).toBeInTheDocument();
  expect(within(table()).getByRole("checkbox", { name: "Select all shown" })).toHaveAttribute("data-state", "indeterminate");

  await userEvent.click(screen.getByRole("button", { name: "Do it" }));
  expect(bulk).toHaveBeenCalledWith(["b", "c"]);

  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByRole("region", { name: /selected/ })).not.toBeInTheDocument();
});

it("select-all takes the rows shown, keeps rows selected elsewhere, and says how many the filter hides", async () => {
  function Filtered() {
    const [selection, setSelection] = useState<RowSelectionState>({ z: true });
    return (
      <DataTable<Row>
        data={ROWS.slice(0, 2)}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        getRowName={(r) => r.name}
        labels={{ table: "Things", selected: (n) => `${n} things selected` }}
        empty={null}
        selectable
        selection={selection}
        onSelectionChange={setSelection}
        bulkActions={(ids) => <output>{ids.join(",")}</output>}
      />
    );
  }
  render(<Filtered />);
  expect(screen.getByRole("region", { name: "1 things selected" })).toHaveTextContent("1 not shown by the filters");

  await userEvent.click(screen.getByRole("checkbox", { name: "Select all shown" }));
  expect(screen.getByRole("region", { name: "3 things selected" })).toHaveTextContent("z,a,b");

  await userEvent.click(screen.getByRole("checkbox", { name: "Select all shown" }));
  expect(screen.getByRole("region", { name: "1 things selected" })).toHaveTextContent("z");
});

it("moves with the arrow keys and j/k, selects with Space and x, activates with Enter", async () => {
  const onActivate = vi.fn();
  renderTable({ selectable: true, bulkActions: () => null, onActivate });
  const rows = within(table()).getAllByRole("row").slice(1);

  // One row in the tab order at a time.
  expect(rows.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

  rows[0].focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(rows[1]).toHaveFocus();
  expect(rows[1]).toHaveAttribute("tabindex", "0");
  await userEvent.keyboard(" ");
  expect(rows[1]).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  expect(onActivate).toHaveBeenCalledWith(ROWS[1]);

  await userEvent.keyboard("j");
  expect(rows[2]).toHaveFocus();
  await userEvent.keyboard("x");
  expect(rows[2]).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Home}");
  expect(rows[0]).toHaveFocus();
  await userEvent.keyboard("k");
  expect(rows[0]).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(rows[2]).toHaveFocus();
});

it("renders a phone list from mobileRow, and none without it", () => {
  const { unmount } = renderTable();
  expect(screen.getByRole("list", { name: "Things" })).toHaveTextContent("Alpha on a phone");
  unmount();

  renderTable({ mobileRow: undefined });
  expect(screen.queryByRole("list", { name: "Things" })).not.toBeInTheDocument();
  expect(table()).toBeInTheDocument();
});

it("renders the caller's empty state instead of an empty table", () => {
  renderTable({ data: [] });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Nothing here because of the filter.")).toBeInTheDocument();
});

it("says how to drive it from the keyboard", () => {
  renderTable({ onActivate: () => {} });
  expect(screen.getByText(/Enter to open/)).toBeInTheDocument();
});

it("keeps a cell's own state when the page rebuilds its columns", async () => {
  // A server re-render hands a page new action references, so it rebuilds its
  // columns; the controls in the cells must not remount and forget.
  function Counter() {
    const [n, setN] = useState(0);
    return (
      <button type="button" onClick={() => setN(n + 1)}>
        Clicked {n}
      </button>
    );
  }
  const columns = (): ColumnDef<Row, unknown>[] => [
    { id: "name", accessorFn: (r) => r.name, header: "Name", meta: { rowHeader: true } },
    { id: "control", header: "Control", cell: () => <Counter /> },
  ];
  const props = { data: ROWS.slice(0, 1), getRowId: (r: Row) => r.id, getRowName: (r: Row) => r.name, labels: { table: "Things" }, empty: null };
  const { rerender } = render(<DataTable<Row> {...props} columns={columns()} />);
  await userEvent.click(screen.getByRole("button", { name: "Clicked 0" }));
  rerender(<DataTable<Row> {...props} columns={columns()} />);
  expect(screen.getByRole("button", { name: "Clicked 1" })).toBeInTheDocument();
});

describe("facetOptions", () => {
  it("counts what each value would leave", () => {
    expect(facetOptions(ROWS, ["x", "y"], (row, v) => (v === "x" ? row.count > 2 : false), (v) => v.toUpperCase())).toEqual([
      { value: "x", label: "X", count: 2 },
      { value: "y", label: "Y", count: 0 },
    ]);
  });

  it("lists the values that occur, once each, sorted", () => {
    expect(uniqueValues(["b", null, "a", "b", undefined, ""])).toEqual(["a", "b"]);
  });
});
