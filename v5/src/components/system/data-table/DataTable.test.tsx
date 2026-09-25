import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, userEvent, within } from "../../../../test/utils/render";
import { DataTable, type DataTableLabels } from "./DataTable";

/**
 * The shared table (UI system spec §6.4): sorting by a header, selection and
 * its bulk bar, the roving-tabindex keyboard, and the empty state.
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
  { id: "name", accessorFn: (r) => r.name, header: "Name", cell: ({ row }) => row.original.name },
  { id: "count", accessorFn: (r) => r.count, header: "Count", meta: { align: "right" }, sortDescFirst: true },
];

const LABELS: DataTableLabels = {
  table: "Things",
  selectAll: "Select all shown",
  selectRow: (name) => `Select ${name}`,
  selected: (n) => (n === 1 ? "thing selected" : "things selected"),
  clearSelection: "Clear selection",
};

function renderTable(props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) {
  return render(
    <DataTable<Row>
      data={ROWS}
      columns={COLUMNS}
      getRowId={(r) => r.id}
      getRowName={(r) => r.name}
      labels={LABELS}
      empty={<p>Nothing here because of the filter.</p>}
      mobileRow={(r) => <span>{r.name}</span>}
      {...props}
    />
  );
}

function bodyNames(): string[] {
  const table = screen.getByRole("table", { name: "Things" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0].textContent ?? "");
}

it("sorts by a header, and says which way on the header cell", async () => {
  renderTable();
  expect(bodyNames()).toEqual(["Alpha", "Bravo", "Charlie"]);

  await userEvent.click(screen.getByRole("button", { name: /Count/ }));
  expect(bodyNames()).toEqual(["Bravo", "Alpha", "Charlie"]);
  expect(screen.getByRole("columnheader", { name: /Count/ })).toHaveAttribute("aria-sort", "descending");
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

  const table = screen.getByRole("table", { name: "Things" });
  await userEvent.click(within(table).getByRole("checkbox", { name: "Select Bravo" }));
  await userEvent.click(within(table).getByRole("checkbox", { name: "Select Charlie" }));
  expect(screen.getByRole("region", { name: "2 things selected" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Do it" }));
  expect(bulk).toHaveBeenCalledWith(["b", "c"]);

  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(screen.queryByRole("region", { name: /selected/ })).not.toBeInTheDocument();
});

it("moves with the arrow keys, selects with Space and activates with Enter", async () => {
  const onActivate = vi.fn();
  renderTable({ selectable: true, bulkActions: () => null, onActivate });
  const rows = within(screen.getByRole("table", { name: "Things" })).getAllByRole("row").slice(1);

  // One row in the tab order at a time.
  expect(rows.map((r) => r.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);

  rows[0].focus();
  await userEvent.keyboard("{ArrowDown}");
  expect(rows[1]).toHaveFocus();
  await userEvent.keyboard(" ");
  expect(rows[1]).toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{Enter}");
  expect(onActivate).toHaveBeenCalledWith(ROWS[1]);
});

it("renders the caller's empty state instead of an empty table", () => {
  renderTable({ data: [] });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("Nothing here because of the filter.")).toBeInTheDocument();
});

it("right-aligns a numeric column", () => {
  renderTable();
  const table = screen.getByRole("table", { name: "Things" });
  const firstRow = within(table).getAllByRole("row")[1];
  expect(within(firstRow).getAllByRole("cell")[1].className).toMatch(/text-right/);
});
