import { render, screen, userEvent, within } from "../../../test/utils/render";
import { InventoryBoard } from "./InventoryBoard";
import { NO_FILTERS, type InventoryFilterState } from "./inventory-filters";
import type { InventoryAttention, InventoryRow } from "../../lib/data/inventory";

/**
 * The inventory on the shared DataTable (UI system spec §6.4): the contract
 * `InventoryFilters` held — filters narrow in the browser and live in the URL,
 * an empty table names the filter that emptied it, a selection goes to
 * Refresh research — plus what the prototype adds: facet counts, status as a
 * word, and the attention flags as words.
 */

type RowOverrides = Partial<Omit<InventoryRow, "attention" | "needsAttention">> & {
  attention?: Partial<InventoryAttention>;
};

function row(overrides: RowOverrides = {}): InventoryRow {
  const attention = {
    noPhoto: false,
    noManual: false,
    openTickets: false,
    neverReviewed: false,
    floorCheck: false,
    ...overrides.attention,
  };
  return {
    id: "t-form-4",
    slug: "form-4",
    name: "Form 4",
    photoUrl: null,
    categoryName: "Resin Printing",
    categoryGroup: "3D Printing",
    room: "Bloomberg 061",
    zone: "Resin Bay",
    unitCount: 1,
    worstUnitStatus: "available",
    state: "published",
    openTicketCount: 0,
    lastReviewedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    ...overrides,
    attention,
    needsAttention: Object.values(attention).some(Boolean),
  };
}

const ROWS: InventoryRow[] = [
  row({ id: "a", slug: "form-4", name: "Form 4" }),
  row({
    id: "b",
    slug: "trotec",
    name: "Trotec Speedy 400",
    state: "draft",
    categoryName: "Laser Cutting",
    room: "Bloomberg 059",
    attention: { noManual: true, openTickets: true },
    openTicketCount: 2,
  }),
  row({ id: "c", slug: "bantam", name: "Bantam CNC", lastReviewedAt: null, attention: { neverReviewed: true } }),
];

function renderBoard(initial: InventoryFilterState = NO_FILTERS, extra: Partial<React.ComponentProps<typeof InventoryBoard>> = {}) {
  return render(<InventoryBoard rows={ROWS} initial={initial} {...extra} />);
}

function table() {
  return screen.getByRole("table", { name: /Tools, their state/ });
}

beforeEach(() => {
  window.history.replaceState(null, "", "/admin/inventory");
});

it("lists every row with its state as a word and its flags as words", () => {
  renderBoard();
  const trotec = within(table()).getByRole("row", { name: /Trotec Speedy 400/ });
  expect(trotec).toHaveTextContent("Draft");
  expect(trotec).toHaveTextContent("No manual · 2 open");
  expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
});

it("narrows by a facet, shows each value's count, and writes the filter into the URL", async () => {
  renderBoard();
  await userEvent.click(screen.getByRole("button", { name: "Needs attention" }));

  const never = await screen.findByRole("menuitemradio", { name: /Never reviewed/ });
  expect(never).toHaveTextContent("1");
  await userEvent.click(never);

  expect(window.location.search).toBe("?attention=never_reviewed");
  expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
  expect(within(table()).getByRole("row", { name: /Bantam CNC/ })).toBeInTheDocument();
});

it("arrives filtered from a link, and an empty table names the filter that emptied it", async () => {
  renderBoard({ ...NO_FILTERS, state: "archived" });
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText(/No tools match State: Archived/)).toBeInTheDocument();

  await userEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
  expect(window.location.search).toBe("");
  expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
});

it("sends the selected tools to Refresh research", async () => {
  const queueRefresh = vi.fn();
  renderBoard(NO_FILTERS, { queueRefresh });

  await userEvent.click(within(table()).getByRole("checkbox", { name: "Select Form 4" }));
  await userEvent.click(within(table()).getByRole("checkbox", { name: "Select Bantam CNC" }));
  await userEvent.click(screen.getByRole("button", { name: "Refresh research (2)" }));

  // The existing dialog opens on exactly the two ids.
  expect(screen.getByText(/Research 2 tools again/)).toBeInTheDocument();
});
