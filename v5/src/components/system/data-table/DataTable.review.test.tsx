import type { ColumnDef } from "@tanstack/react-table";
import { render, screen, userEvent, within } from "../../../../test/utils/render";
import { DataTable, type DataTableProps } from "./DataTable";

/**
 * What the review surfaces added to the shared table (UI system phase 3):
 * rows that cannot be selected and say why, a header box that skips them, and
 * the container layout the chat's intake table uses — the panel's width, not
 * the viewport's, decides between the table and the list, and never both.
 */

interface Row {
  id: string;
  name: string;
  blocked: boolean;
}

const ROWS: Row[] = [
  { id: "a", name: "Alpha", blocked: false },
  { id: "b", name: "Bravo", blocked: true },
];

const COLUMNS: ColumnDef<Row, unknown>[] = [
  { id: "name", accessorFn: (r) => r.name, header: "Name", meta: { rowHeader: true }, cell: ({ row }) => row.original.name },
];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  return render(
    <>
      <p id="why-b">Decide the duplicate first.</p>
      <DataTable<Row>
        data={ROWS}
        columns={COLUMNS}
        getRowId={(r) => r.id}
        getRowName={(r) => r.name}
        labels={{ table: "Things", selectAll: "Select every row" }}
        empty={null}
        selectable
        canSelectRow={(r) => !r.blocked}
        selectDescribedBy={(r) => (r.blocked ? "why-b" : undefined)}
        mobileRow={(r, state) => (
          <label>
            <input type="checkbox" checked={state.selected} disabled={!state.canSelect} onChange={state.toggle} />
            {r.name} in the list
          </label>
        )}
        {...props}
      />
    </>
  );
}

it("disables a row that cannot be selected, says why, and select-all skips it", async () => {
  renderTable({ layout: "container" });
  const table = screen.getByRole("table", { name: "Things" });
  const blocked = within(table).getByRole("checkbox", { name: "Select Bravo" });
  expect(blocked).toBeDisabled();
  expect(blocked).toHaveAccessibleDescription("Decide the duplicate first.");

  const all = within(table).getByRole("checkbox", { name: "Select every row" });
  await userEvent.click(all);
  expect(within(table).getByRole("checkbox", { name: "Select Alpha" })).toBeChecked();
  expect(blocked).not.toBeChecked();
  // Every row that can be selected is: the header box says all, not some.
  expect(all).toBeChecked();
});

it("disables the header box when no row can be selected", () => {
  renderTable({ layout: "container", canSelectRow: () => false });
  expect(screen.getByRole("checkbox", { name: "Select every row" })).toBeDisabled();
});

describe("container layout", () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
  });

  function widthIs(width: number) {
    HTMLElement.prototype.getBoundingClientRect = function () {
      return { width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
  }

  it("keeps the table, and only the table, when the container cannot be measured", () => {
    renderTable({ layout: "container" });
    expect(screen.getByRole("table", { name: "Things" })).toBeInTheDocument();
    expect(screen.queryByText("Alpha in the list")).not.toBeInTheDocument();
  });

  it("renders the list, and only the list, in a narrow container — with its own select-all", async () => {
    widthIs(360);
    renderTable({ layout: "container", listSelectAll: "Research all" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Things" })).toBeInTheDocument();
    expect(screen.getByText("Bravo in the list")).toBeInTheDocument();
    expect(screen.getByText("Research all")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "Select every row" }));
    expect(screen.getByRole("checkbox", { name: "Alpha in the list" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bravo in the list" })).toBeDisabled();
  });

  it("renders the table in a wide container", () => {
    widthIs(900);
    renderTable({ layout: "container" });
    expect(screen.getByRole("table", { name: "Things" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Things" })).not.toBeInTheDocument();
  });
});
