import { render, screen, userEvent, within } from "../../../test/utils/render";
import { InventoryBoard } from "./InventoryBoard";
import { NO_FILTERS, type InventoryFilterState } from "./inventory-filters";
import type { InventoryAttention, InventoryRow } from "../../lib/data/inventory";

/**
 * `/admin/inventory` on the shared DataTable (UI system spec §7.3): the
 * contract the old filter console held — rows narrow in the browser, the
 * filters live in the URL, an empty table names the filter that emptied it,
 * a selection goes to Refresh research — plus what the table adds: facet
 * counts, status as a glyph and a word, and the attention flags as words.
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
    officialName: null,
    photoUrl: null,
    categoryName: "Resin Printing",
    categoryGroup: "3D Printing",
    room: "Bloomberg 061",
    zone: "Resin Bay",
    unitCount: 1,
    worstUnitStatus: "available",
    state: "published",
    openTicketCount: 0,
    openRefreshId: null,
    lastReviewedAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    ...overrides,
    attention,
    needsAttention: Object.values(attention).some(Boolean),
  } as InventoryRow;
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
  row({
    id: "c",
    slug: "shopbot",
    name: "ShopBot Desktop",
    state: "archived",
    categoryName: "Laser Cutting",
    room: "Bloomberg 059",
    unitCount: 0,
    worstUnitStatus: null,
    lastReviewedAt: null,
  }),
];

function setup(initial: InventoryFilterState = NO_FILTERS, extra: Partial<React.ComponentProps<typeof InventoryBoard>> = {}) {
  window.history.replaceState(null, "", "/admin/inventory");
  render(<InventoryBoard rows={ROWS} initial={initial} {...extra} />);
  return userEvent.setup();
}

function table() {
  return screen.getByRole("table", { name: /Tools, their state/ });
}

/** The tool names in the table, in order (the phone list repeats them in jsdom). */
function toolNames(): string[] {
  const found = screen.queryByRole("table", { name: /Tools, their state/ });
  if (!found) return [];
  return within(found)
    .getAllByRole("rowheader")
    .map((cell) => within(cell).getAllByRole("link")[0].textContent ?? "");
}

async function pickFacet(user: ReturnType<typeof userEvent.setup>, facet: string, value: RegExp) {
  await user.click(within(screen.getByRole("search")).getByRole("button", { name: new RegExp(`^${facet}`) }));
  await user.click(await screen.findByRole("menuitemradio", { name: value }));
}

describe("InventoryBoard — the table", () => {
  it("lists every tool with its state as a word and its flags as words", () => {
    setup();
    expect(toolNames()).toEqual(["Form 4", "Trotec Speedy 400", "ShopBot Desktop"]);
    const trotec = within(table()).getByRole("row", { name: /Trotec Speedy 400/ });
    expect(trotec).toHaveTextContent("Draft");
    expect(trotec).toHaveTextContent("No manual · 2 open");
    expect(screen.getByText("Showing 3 of 3")).toBeInTheDocument();
  });

  it("marks a missing photo instead of inventing one, and says never reviewed", () => {
    setup();
    const form = within(table()).getByRole("row", { name: /Form 4/ });
    expect(within(form).getByRole("img", { name: "No photo" })).toBeInTheDocument();
    const shopbot = within(table()).getByRole("row", { name: /ShopBot/ });
    expect(shopbot).toHaveTextContent("Never");
    expect(form).toHaveTextContent("2026-06-01");
  });

  it("links the name at its public page, and tags an open refresh", () => {
    window.history.replaceState(null, "", "/admin/inventory");
    render(<InventoryBoard rows={[row({ openRefreshId: "r1" })]} initial={NO_FILTERS} />);
    expect(within(table()).getByRole("link", { name: "Form 4" })).toHaveAttribute("href", "/tools/form-4");
    expect(within(table()).getByRole("link", { name: "Refresh open" })).toHaveAttribute("href", "/admin/refresh/r1");
  });

  it("sorts by a column header", async () => {
    const user = setup();
    await user.click(within(table()).getByRole("button", { name: /Tickets/ }));
    expect(toolNames()[0]).toBe("Trotec Speedy 400");
    expect(within(table()).getByRole("columnheader", { name: /Tickets/ })).toHaveAttribute("aria-sort", "descending");
  });

  it("hides and shows a column from the Columns menu", async () => {
    const user = setup();
    expect(within(table()).queryByRole("columnheader", { name: /Last updated/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Last updated" }));
    // The menu stays open while columns are toggled; Escape closes it.
    expect(screen.getByRole("menuitemcheckbox", { name: "Last updated" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(within(table()).getByRole("columnheader", { name: /Last updated/ })).toBeInTheDocument();
  });
});

describe("InventoryBoard — filters", () => {
  it("arrives filtered when the URL said so, with the value on the facet", () => {
    setup({ ...NO_FILTERS, state: "draft" });
    expect(toolNames()).toEqual(["Trotec Speedy 400"]);
    expect(within(screen.getByRole("search")).getByRole("button", { name: "State: Draft" })).toBeInTheDocument();
  });

  it("shows how many rows each value would leave, given the other filters", async () => {
    const user = setup({ ...NO_FILTERS, category: "Laser Cutting" });
    await user.click(within(screen.getByRole("search")).getByRole("button", { name: /^State/ }));
    expect(await screen.findByRole("menuitemradio", { name: /Draft/ })).toHaveTextContent("1");
    // Nothing published is in Laser Cutting: offered, but disabled.
    expect(screen.getByRole("menuitemradio", { name: /Published/ })).toHaveAttribute("aria-disabled", "true");
  });

  it("narrows by a facet and writes it into the URL", async () => {
    const user = setup();
    await pickFacet(user, "Needs attention", /Anything flagged/);
    expect(toolNames()).toEqual(["Trotec Speedy 400"]);
    expect(window.location.search).toBe("?attention=any");
    expect(screen.getByText("Showing 1 of 3")).toBeInTheDocument();

    await pickFacet(user, "Location", /Bloomberg 059/);
    expect(window.location.search).toBe("?location=Bloomberg+059&attention=any");
  });

  it("searches the name, the category and the slug", async () => {
    const user = setup();
    const search = screen.getByRole("searchbox", { name: "Search" });
    await user.type(search, "speedy");
    expect(toolNames()).toEqual(["Trotec Speedy 400"]);
    await user.clear(search);
    await user.type(search, "shopbot");
    expect(toolNames()).toEqual(["ShopBot Desktop"]);
  });

  it("offers only the categories the rows use", async () => {
    const user = setup();
    await user.click(within(screen.getByRole("search")).getByRole("button", { name: /^Category/ }));
    const items = await screen.findAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent?.replace(/\d+$/, ""))).toEqual(["Any", "Laser Cutting", "Resin Printing"]);
  });

  it("names the filter that emptied the table, and Clear takes it out of the URL", async () => {
    const user = setup({ ...NO_FILTERS, state: "draft", category: "Resin Printing" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/No tools match State: Draft, Category: Resin Printing/)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(window.location.search).toBe("");
    expect(toolNames()).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });

  it("says the inventory is empty differently from a filter hiding it", () => {
    window.history.replaceState(null, "", "/admin/inventory");
    render(<InventoryBoard rows={[]} initial={NO_FILTERS} />);
    expect(screen.getByText(/No tools yet/)).toBeInTheDocument();
  });
});

describe("InventoryBoard — refresh research", () => {
  it("offers no checkboxes without the refresh action", () => {
    setup();
    expect(screen.queryByRole("checkbox", { name: "Select Form 4" })).not.toBeInTheDocument();
  });

  it("keeps a selection across filters, says what the filter hides, and sends exactly those ids", async () => {
    const action = vi.fn(async () => ({ ok: true as const, queued: 2, skipped: 0, missing: 0 }));
    const user = setup({ ...NO_FILTERS, state: "published" }, { queueRefresh: action });

    await user.click(within(table()).getByRole("checkbox", { name: "Select all shown" }));
    expect(screen.getByRole("region", { name: "1 tool selected" })).toBeInTheDocument();

    await pickFacet(user, "State", /Draft/);
    expect(screen.getByRole("region", { name: "1 tool selected" })).toHaveTextContent("1 not shown by the filters");

    await user.click(within(table()).getByRole("checkbox", { name: "Select Trotec Speedy 400" }));
    await user.click(screen.getByRole("button", { name: "Refresh research (2)" }));
    await user.click(screen.getByRole("button", { name: "Refresh 2" }));
    expect(action).toHaveBeenCalledWith({ toolIds: ["a", "b"], includeDescription: false, note: null });
    expect(await screen.findByText("Refreshing 2 tools — results appear on the Refresh page.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /selected/ })).not.toBeInTheDocument();
  });
});
