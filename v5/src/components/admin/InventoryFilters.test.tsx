import { render, screen, userEvent, within } from "../../../test/utils/render";
import { InventoryFilters } from "./InventoryFilters";
import { NO_FILTERS, type InventoryFilterState } from "./inventory-filters";
import type { InventoryAttention, InventoryRow } from "../../lib/data/inventory";

/**
 * The filter console: what it hides, what it says when it has hidden
 * everything, and what it leaves in the URL.
 *
 * The last one is the point of the whole island — "every tool with no manual"
 * has to be a link somebody can send.
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
    attention: { noManual: true },
  }),
  row({
    id: "c",
    slug: "shopbot",
    name: "ShopBot Desktop",
    state: "archived",
    categoryName: "Laser Cutting",
    room: "Bloomberg 059",
  }),
];

function setup(initial: InventoryFilterState = NO_FILTERS, rows: InventoryRow[] = ROWS) {
  window.history.replaceState(null, "", "/admin/inventory");
  render(<InventoryFilters rows={rows} initial={initial} />);
  return userEvent.setup();
}

/**
 * The filter console's own control, by role: "Needs attention" also labels the
 * badge list on every flagged row, and a page that says the same phrase twice
 * is the page working — the filter and the flags are the same idea.
 */
function selectFor(label: string): HTMLElement {
  return screen.getByRole("combobox", { name: label });
}

function toolNames(): string[] {
  const table = screen.queryByRole("table");
  if (!table) return [];
  return within(table)
    .getAllByRole("link")
    .map((link) => link.textContent ?? "");
}

describe("InventoryFilters", () => {
  it("shows every tool until something narrows it", () => {
    setup();
    expect(toolNames()).toEqual(["Form 4", "Trotec Speedy 400", "ShopBot Desktop"]);
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
  });

  it("arrives filtered when the URL said so", () => {
    setup({ ...NO_FILTERS, state: "draft" });

    expect(toolNames()).toEqual(["Trotec Speedy 400"]);
    expect(selectFor("State")).toHaveValue("draft");
  });

  it("narrows by state", async () => {
    const user = setup();
    await user.selectOptions(selectFor("State"), "archived");

    expect(toolNames()).toEqual(["ShopBot Desktop"]);
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();
  });

  it("narrows by category and by location", async () => {
    const user = setup();

    await user.selectOptions(selectFor("Category"), "Resin Printing");
    expect(toolNames()).toEqual(["Form 4"]);

    await user.selectOptions(selectFor("Category"), "");
    await user.selectOptions(selectFor("Location"), "Bloomberg 059");
    expect(toolNames()).toEqual(["Trotec Speedy 400", "ShopBot Desktop"]);
  });

  it("narrows to the rows with something wrong — the filter a review starts from", async () => {
    const user = setup();
    await user.selectOptions(selectFor("Needs attention"), "any");

    expect(toolNames()).toEqual(["Trotec Speedy 400"]);
  });

  it("searches the name, the category and the slug", async () => {
    const user = setup();
    const search = screen.getByRole("searchbox", { name: "Search" });

    await user.type(search, "speedy");
    expect(toolNames()).toEqual(["Trotec Speedy 400"]);

    await user.clear(search);
    await user.type(search, "laser");
    expect(toolNames()).toEqual(["Trotec Speedy 400", "ShopBot Desktop"]);

    await user.clear(search);
    // A reviewer arriving from a link has a slug in hand, not a name.
    await user.type(search, "shopbot");
    expect(toolNames()).toEqual(["ShopBot Desktop"]);
  });

  it("offers only the categories and locations the rows actually use", () => {
    setup();
    const options = within(selectFor("Category"))
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(options).toEqual(["Any", "Laser Cutting", "Resin Printing"]);
  });

  it("names the filter that is hiding everything, not just 'no results'", async () => {
    const user = setup();
    await user.selectOptions(selectFor("State"), "draft");
    await user.selectOptions(selectFor("Category"), "Resin Printing");

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText(/State: Draft, Category: Resin Printing/)
    ).toBeInTheDocument();
  });

  it("says the inventory is empty differently from a filter hiding it", () => {
    setup(NO_FILTERS, []);
    expect(screen.getByText(/No tools yet/)).toBeInTheDocument();
  });

  it("puts the filters in the URL so the view can be linked", async () => {
    const user = setup();
    await user.selectOptions(selectFor("Needs attention"), "no_manual");
    await user.selectOptions(selectFor("State"), "draft");

    expect(window.location.search).toBe("?state=draft&attention=no_manual");
  });

  it("takes the filters back out of the URL when they are cleared", async () => {
    const user = setup({ ...NO_FILTERS, state: "draft" });
    expect(window.location.search).toBe("?state=draft");

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(window.location.search).toBe("");
    expect(toolNames()).toHaveLength(3);
  });

  it("offers nothing to clear until something is filtered", async () => {
    const user = setup();
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

    await user.selectOptions(selectFor("State"), "draft");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });
});

describe("InventoryFilters — refresh research (refresh research spec §5.1, §6)", () => {
  it("offers no checkboxes without the refresh action", () => {
    setup();
    expect(screen.queryByRole("checkbox", { name: "Select Form 4" })).not.toBeInTheDocument();
  });

  it("selects rows by checkbox or all shown, and opens the dialog with them", async () => {
    window.history.replaceState(null, "", "/admin/inventory");
    const action = vi.fn(async () => ({ ok: true as const, queued: 2, skipped: 0, missing: 0 }));
    render(<InventoryFilters rows={ROWS} initial={{ ...NO_FILTERS, state: "published" }} queueRefresh={action} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Select all shown" }));
    expect(screen.getByText("1 tool selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Trotec Speedy 400" }));
    expect(screen.getByText("2 tools selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh research (2)" }));
    await user.click(screen.getByRole("button", { name: "Refresh 2" }));
    expect(action).toHaveBeenCalledWith({ toolIds: ["a", "b"], includeDescription: false, note: null });
    expect(await screen.findByText("Refreshing 2 tools — results appear on the Refresh page.")).toBeInTheDocument();
    // Queued: the selection is cleared.
    expect(screen.queryByText("2 tools selected")).not.toBeInTheDocument();
  });

  it("filters by Needs floor check, and tags a row with an open refresh", async () => {
    const rows = [...ROWS, row({ id: "d", slug: "grey-box", name: "Grey box", attention: { floorCheck: true }, openRefreshId: "r1" })];
    const user = setup(NO_FILTERS, rows);
    await user.selectOptions(selectFor("Needs attention"), "floor_check");
    expect(screen.getByRole("link", { name: "Grey box" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Form 4" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Refresh open" })).toHaveAttribute("href", "/admin/refresh/r1");
  });
});
