import { render, screen, within } from "../../../test/utils/render";
import { InventoryTable } from "./InventoryTable";
import type { InventoryAttention, InventoryRow } from "../../lib/data/inventory";

/**
 * The review table's rendering.
 *
 * `InventoryTable` has no `async` and no data access, which is exactly why it
 * can be mounted here: everything it shows arrived as a prop.
 */

/** Overrides where `attention` may name just the flags the case is about. */
type RowOverrides = Partial<Omit<InventoryRow, "attention" | "needsAttention">> & {
  attention?: Partial<InventoryAttention>;
};

function row(overrides: RowOverrides = {}): InventoryRow {
  const attention = {
    noPhoto: false,
    noManual: false,
    openTickets: false,
    neverReviewed: false,
    ...overrides.attention,
  };
  return {
    id: "t-form-4",
    slug: "form-4",
    name: "Form 4",
    photoUrl: "https://blob.test/form-4.jpg",
    categoryName: "Resin Printing",
    categoryGroup: "3D Printing",
    room: "Bloomberg 061",
    zone: "Resin Bay",
    unitCount: 2,
    worstUnitStatus: "available",
    state: "published",
    openTicketCount: 0,
    lastReviewedAt: new Date("2026-06-01T09:00:00.000Z"),
    updatedAt: new Date("2026-09-20T12:00:00.000Z"),
    ...overrides,
    attention,
    needsAttention: Object.values(attention).some(Boolean),
  };
}

function rowFor(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

describe("InventoryTable", () => {
  it("shows each tool's category, location, units and dates", () => {
    render(<InventoryTable rows={[row()]} emptyMessage="nothing" />);

    const tableRow = rowFor("Form 4");
    expect(within(tableRow).getByText("Resin Printing")).toBeInTheDocument();
    expect(within(tableRow).getByText("Bloomberg 061")).toBeInTheDocument();
    expect(within(tableRow).getByText("2")).toBeInTheDocument();
    expect(within(tableRow).getByText("Available")).toBeInTheDocument();
    expect(within(tableRow).getByText("2026-06-01")).toBeInTheDocument();
    expect(within(tableRow).getByText("2026-09-20")).toBeInTheDocument();
  });

  it("links the name at its public page", () => {
    render(<InventoryTable rows={[row()]} emptyMessage="nothing" />);
    expect(screen.getByRole("link", { name: "Form 4" })).toHaveAttribute("href", "/tools/form-4");
  });

  it("lists drafts and archived tools, each marked with its state", () => {
    render(
      <InventoryTable
        rows={[
          row({ id: "a", slug: "a", name: "A Tool", state: "draft" }),
          row({ id: "b", slug: "b", name: "B Tool", state: "archived" }),
        ]}
        emptyMessage="nothing"
      />
    );

    expect(within(rowFor("A Tool")).getByText("Draft")).toBeInTheDocument();
    expect(within(rowFor("B Tool")).getByText("Archived")).toBeInTheDocument();
  });

  it("marks a missing photo instead of showing a stand-in image", () => {
    render(<InventoryTable rows={[row({ photoUrl: null })]} emptyMessage="nothing" />);

    expect(screen.getByLabelText("No photo")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "" })).not.toBeInTheDocument();
  });

  it("says a tool has never been reviewed rather than leaving the cell blank", () => {
    render(<InventoryTable rows={[row({ lastReviewedAt: null })]} emptyMessage="nothing" />);
    expect(screen.getByText("Never")).toBeInTheDocument();
  });

  it("names every reason a row needs attention, with the ticket count", () => {
    render(
      <InventoryTable
        rows={[
          row({
            attention: {
              noPhoto: true,
              noManual: true,
              openTickets: true,
              neverReviewed: true,
            },
            openTicketCount: 3,
          }),
        ]}
        emptyMessage="nothing"
      />
    );

    const flags = within(screen.getByRole("list", { name: "Needs attention" }));
    expect(flags.getByText("No photo")).toBeInTheDocument();
    expect(flags.getByText("No manual")).toBeInTheDocument();
    expect(flags.getByText("Never reviewed")).toBeInTheDocument();
    expect(flags.getByText("3 open")).toBeInTheDocument();
  });

  it("shows no attention list at all for a row with nothing wrong", () => {
    render(<InventoryTable rows={[row()]} emptyMessage="nothing" />);
    expect(screen.queryByRole("list", { name: "Needs attention" })).not.toBeInTheDocument();
  });

  it("says a tool has no units rather than showing a bare zero", () => {
    render(
      <InventoryTable rows={[row({ unitCount: 0, worstUnitStatus: null })]} emptyMessage="x" />
    );
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("renders the caller's empty message instead of a table", () => {
    render(<InventoryTable rows={[]} emptyMessage="No tools match state: Draft." />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No tools match state: Draft.")).toBeInTheDocument();
  });
});
