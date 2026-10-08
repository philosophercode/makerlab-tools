import { render, screen, within, userEvent } from "../../test/utils/render";
import { GalleryShell } from "./GalleryShell";
import { mockCatalog } from "../../test/fixtures/catalog";
import type { MakerLabTool } from "./catalog-types";
import { useChatLauncher } from "./ChatLauncherContext";
import { useCatalogueState } from "./use-catalogue-state";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// Render Next's image/link as plain elements for deterministic, router-free
// component tests. GalleryShell renders ToolCard (grid) and a DataTable (table).
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * The tool list under the home page's search (UI system phase 5a; student
 * home spec 2026-10-07, amendment "One page: the list at rest"): grouped by
 * category in the lab's order at rest, the category chips, the FilterBar's
 * facets, Sort and Group by, grid and table, the results in place of the
 * groups while searching — every choice in the URL. The search box itself is
 * `HomeSearch` (HomeShell.test.tsx); here the query arrives in the URL.
 */

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  router.push.mockReset();
});

/** The list wired to the URL as the home page wires it. */
function Gallery({ tools = mockCatalog, categoryOrder = [] }: { tools?: MakerLabTool[]; categoryOrder?: string[] }) {
  const { state, set, view } = useCatalogueState(tools, categoryOrder);
  return <GalleryShell tools={tools} state={state} set={set} view={view} categoryOrder={categoryOrder} />;
}

/** Dates for "Recently added": the Form 4 newest, the Bandsaw oldest. */
const DATED: MakerLabTool[] = mockCatalog.map((tool) => ({
  ...tool,
  addedAt: {
    bandsaw: "2024-01-01T00:00:00.000Z",
    "prusa-mk4": "2025-01-01T00:00:00.000Z",
    "trotec-speedy-400": "2025-06-01T00:00:00.000Z",
    "form-4": "2026-09-01T00:00:00.000Z",
  }[tool.slug] ?? null,
}));

/** The card names on the page, in order (every section's). */
function cardNames(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="tool-card"]')).map(
    (card) => within(card as HTMLElement).getByRole("heading").textContent ?? ""
  );
}

/** The section headings' labels, in order. */
function sectionLabels(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2 > span:first-child')).map((el) => el.textContent ?? "");
}

function bar() {
  return screen.getByRole("search", { name: "Filter the tools" });
}

async function pick(user: ReturnType<typeof userEvent.setup>, control: string, value: RegExp) {
  await user.click(within(bar()).getByRole("button", { name: new RegExp(`^${control}`) }));
  await user.click(await screen.findByRole("menuitemradio", { name: value }));
}

describe("GalleryShell — at rest, grouped by category", () => {
  it("groups every tool by category, alphabetically without the lab's order, each heading with its count", () => {
    render(<Gallery />);
    expect(sectionLabels()).toEqual(["3D Printing", "Laser", "Woodworking"]);
    const headings = Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2')).map((h) => h.textContent);
    expect(headings).toEqual(["3D Printing2 tools", "Laser1 tool", "Woodworking1 tool"]);
    // Each section is a region named by its heading; cards drop to h3 beneath it.
    const printing = screen.getByRole("region", { name: /3D Printing/ });
    expect(within(printing).getAllByRole("heading", { level: 3 }).map((h) => h.textContent).sort()).toEqual(["Form 4", "Prusa MK4"]);
    // The heading sticks under the top bar while its section scrolls.
    expect(printing.querySelector("h2")!.className).toMatch(/sticky/);
    // The default grouping is not written to the URL.
    expect(window.location.search).toBe("");
  });

  it("follows the lab's category order", () => {
    render(<Gallery categoryOrder={["Woodworking", "Laser", "3D Printing"]} />);
    expect(sectionLabels()).toEqual(["Woodworking", "Laser", "3D Printing"]);
    expect(cardNames()).toEqual(["Bandsaw", "Trotec Speedy 400", "Prusa MK4", "Form 4"]);
  });

  it("states the count it leaves as filters apply", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    expect(screen.getByText("Showing 4 of 4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Laser/ }));
    expect(screen.getByText("Showing 1 of 4")).toBeInTheDocument();
  });

  it("reads its filters from the URL (a view is a link)", () => {
    window.history.replaceState(null, "", "/?location=MakerLab&view=grid&sort=bogus");
    render(<Gallery />);
    expect(cardNames().sort()).toEqual(["Form 4", "Prusa MK4"]);
    // An unknown sort is dropped, not an error.
    expect(within(bar()).getByRole("button", { name: "Sort: Name A–Z" })).toBeInTheDocument();
  });
});

describe("GalleryShell — category chips", () => {
  it("offers All and every category in the lab's order with its count, All pressed", () => {
    render(<Gallery categoryOrder={["Laser", "3D Printing", "Woodworking"]} />);
    const chips = within(screen.getByRole("group", { name: "Categories" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["All4", "Laser1", "3D Printing2", "Woodworking1"]);
    expect(chips[0]).toHaveAttribute("aria-pressed", "true");
    expect(chips[1]).toHaveAttribute("aria-pressed", "false");
  });

  it("filters to a category, writes ?category=, and a second press (or All) shows every group again", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: /^3D Printing/ }));
    expect(window.location.search).toBe("?category=3D+Printing");
    expect(sectionLabels()).toEqual(["3D Printing"]);
    expect(screen.getByRole("button", { name: /^3D Printing/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /^3D Printing/ }));
    expect(window.location.search).toBe("");
    expect(sectionLabels()).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: /^Laser/ }));
    await user.click(screen.getByRole("button", { name: /^All/ }));
    expect(sectionLabels()).toHaveLength(3);
  });

  it("puts a category hidden from the list by default last, one press away", async () => {
    const user = userEvent.setup();
    const tools = mockCatalog.map((tool) =>
      tool.slug === "bandsaw" ? { ...tool, category: "Shop Infrastructure & Supplies", galleryHidden: true } : tool
    );
    render(<Gallery tools={tools} categoryOrder={["Shop Infrastructure & Supplies", "3D Printing", "Laser"]} />);
    const chips = within(screen.getByRole("group", { name: "Categories" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["All3", "3D Printing2", "Laser1", "Shop Infrastructure & Supplies1"]);
    expect(cardNames()).not.toContain("Bandsaw");
    await user.click(screen.getByRole("button", { name: /^Shop Infrastructure/ }));
    expect(cardNames()).toEqual(["Bandsaw"]);
  });

  it("counts what the other filters leave", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await pick(user, "Status", /^Available/);
    const chips = within(screen.getByRole("group", { name: "Categories" })).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["All2", "3D Printing1", "Laser0", "Woodworking1"]);
  });
});

describe("GalleryShell — facets", () => {
  it("offers Status, Material, Location and Item kind in the bar — Category is the chips", () => {
    render(<Gallery />);
    for (const name of [/^Status/, /^Material/, /^Location/, /^Item kind/]) {
      expect(within(bar()).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(bar()).queryByRole("button", { name: /^Category$/ })).not.toBeInTheDocument();
  });

  it("filters by material and by location", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await pick(user, "Material", /^PLA/);
    expect(cardNames()).toEqual(["Prusa MK4"]);
    await user.click(within(bar()).getByRole("button", { name: "Clear filters" }));
    await pick(user, "Location", /Laser Room/);
    expect(cardNames()).toEqual(["Trotec Speedy 400"]);
  });

  it("filters by item kind (taxonomy v2 facet), a tool with none counting as equipment, and writes ?kind=", async () => {
    const user = userEvent.setup();
    const tools = mockCatalog.map((tool) => (tool.slug === "form-4" ? { ...tool, itemKind: "accessory" as const } : tool));
    render(<Gallery tools={tools} />);
    await user.click(within(bar()).getByRole("button", { name: /^Item kind/ }));
    expect(await screen.findByRole("menuitemradio", { name: /Equipment/ })).toHaveTextContent("3");
    await user.click(screen.getByRole("menuitemradio", { name: /Accessory/ }));
    expect(cardNames()).toEqual(["Form 4"]);
    expect(window.location.search).toBe("?kind=accessory");
  });

  it("filters by status with counts, writes ?status=, and the same filter drives the grid and the table", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(within(bar()).getByRole("button", { name: /^Status/ }));
    const item = await screen.findByRole("menuitemradio", { name: /In use/ });
    expect(item).toHaveTextContent(/\d/);
    await user.click(item);
    expect(window.location.search).toBe("?status=In+Use");
    expect(cardNames()).toEqual(["Prusa MK4"]);

    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = await screen.findByRole("table", { name: "Tools: 3D Printing" });
    expect(within(table).getByRole("row", { name: /Prusa MK4/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Bandsaw/ })).not.toBeInTheDocument();
  });

  it("puts the facets behind a Filters button that counts the ones in it", async () => {
    window.history.replaceState(null, "", "/?status=Available&location=MakerLab&category=3D%20Printing");
    const user = userEvent.setup();
    render(<Gallery />);
    // The category is a chip, outside the sheet: two set, not three.
    const filters = await screen.findByRole("button", { name: "Filters, 2 set" });
    await user.click(filters);
    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("button", { name: /^Status/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^Group by/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /^Show \d+ results?/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("GalleryShell — searching", () => {
  it("swaps the groups for the matching tools, best match first, under a heading that names the search", () => {
    window.history.replaceState(null, "", "/?q=prusa");
    render(<Gallery />);
    expect(document.querySelector('[data-slot="gallery-section"]')).toBeNull();
    const results = screen.getByRole("region", { name: /Results for “prusa”/ });
    expect(within(results).getByRole("heading", { level: 2 })).toHaveTextContent("1 tool");
    expect(cardNames()).toEqual(["Prusa MK4"]);
    expect(screen.getByText("Showing 1 of 4")).toBeInTheDocument();
  });

  it("finds a tool by its details when its name does not match", () => {
    // Acrylic is one of the Trotec's materials; its name does not say it.
    window.history.replaceState(null, "", "/?q=acrylic");
    render(<Gallery />);
    expect(cardNames()).toEqual(["Trotec Speedy 400"]);
  });

  it("ends the results with Ask MakerLAB AI, a button that opens the chat", async () => {
    window.history.replaceState(null, "", "/?q=form");
    const user = userEvent.setup();
    function ChatProbe() {
      const { isOpen, pendingSeed } = useChatLauncher();
      return <output data-testid="chat">{isOpen ? `open|${pendingSeed?.text ?? ""}` : "closed"}</output>;
    }
    render(
      <>
        <Gallery />
        <ChatProbe />
      </>
    );
    await user.click(screen.getByRole("button", { name: /Ask MakerLAB AI: “form”/ }));
    expect(screen.getByTestId("chat")).toHaveTextContent("open|form");
  });

  it("names the search that emptied the list, with Clear and the Ask button", async () => {
    window.history.replaceState(null, "", "/?q=zzz-no-such-tool");
    const user = userEvent.setup();
    render(<Gallery />);
    const empty = screen.getByRole("region", { name: "Tool gallery" });
    expect(within(empty).getByText('No tools match "zzz-no-such-tool".')).toBeInTheDocument();
    expect(within(empty).getByRole("button", { name: /Ask MakerLAB AI: “zzz-no-such-tool”/ })).toBeInTheDocument();
    await user.click(within(empty).getByRole("button", { name: "Clear filters" }));
    expect(cardNames()).toHaveLength(mockCatalog.length);
    expect(window.location.search).toBe("");
  });

  it("calls the default sort 'Best match' while searching", () => {
    window.history.replaceState(null, "", "/?q=resin");
    render(<Gallery />);
    expect(within(bar()).getByRole("button", { name: "Sort: Best match" })).toBeInTheDocument();
  });

  it("shows the results as one table in the table view", async () => {
    window.history.replaceState(null, "", "/?q=o&view=table");
    render(<Gallery />);
    const table = await screen.findByRole("table", { name: "Results for “o”" });
    expect(within(table).getAllByRole("rowheader").length).toBeGreaterThan(1);
  });
});

describe("GalleryShell — sort", () => {
  it("sorts inside every group: Z–A, recently added and availability, and writes ?sort=", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/?group=none");
    render(<Gallery tools={DATED} />);
    // The default is the catalogue's own order (the database's name order).
    expect(cardNames()).toEqual(DATED.map((tool) => tool.name));

    await pick(user, "Sort", /Name Z–A/);
    expect(cardNames()).toEqual(["Trotec Speedy 400", "Prusa MK4", "Form 4", "Bandsaw"]);
    expect(window.location.search).toBe("?sort=name-desc&group=none");

    await pick(user, "Sort", /Recently added/);
    expect(cardNames()).toEqual(["Form 4", "Trotec Speedy 400", "Prusa MK4", "Bandsaw"]);

    await pick(user, "Sort", /Most available/);
    // The Trotec's only unit is offline: nothing to walk up to, so it sorts last.
    expect(cardNames().at(-1)).toBe("Trotec Speedy 400");

    await pick(user, "Sort", /Name A–Z/);
    expect(window.location.search).toBe("?group=none");
  });

  it("applies the sort inside every section", () => {
    window.history.replaceState(null, "", "/?sort=name-desc");
    render(<Gallery />);
    expect(cardNames()).toEqual(["Prusa MK4", "Form 4", "Trotec Speedy 400", "Bandsaw"]);
  });
});

describe("GalleryShell — group by", () => {
  it("rests on Category; None is one list with h2 cards, kept in the URL", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    expect(within(bar()).getByRole("button", { name: "Group by: Category" })).toBeInTheDocument();
    await pick(user, "Group by", /^None/);
    expect(window.location.search).toBe("?group=none");
    expect(document.querySelector('[data-slot="gallery-section"]')).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).sort()).toEqual(
      ["Bandsaw", "Form 4", "Prusa MK4", "Trotec Speedy 400"]
    );
    await pick(user, "Group by", /^Category/);
    expect(window.location.search).toBe("");
  });

  it("groups by subcategory within its category, and by location", () => {
    window.history.replaceState(null, "", "/?group=category");
    const { unmount } = render(<Gallery />);
    expect(sectionLabels()).toEqual(["3D Printing › FDM", "3D Printing › Resin", "Laser › CO2", "Woodworking › Cutting"]);
    unmount();

    window.history.replaceState(null, "", "/?group=location");
    render(<Gallery />);
    expect(sectionLabels()).toEqual(["Laser Room", "MakerLab", "Wood Shop"]);
  });

  it("reads an old link's ?group=categoryGroup as the default", () => {
    window.history.replaceState(null, "", "/?group=categoryGroup");
    render(<Gallery />);
    expect(sectionLabels()).toEqual(["3D Printing", "Laser", "Woodworking"]);
    expect(within(bar()).getByRole("button", { name: "Group by: Category" })).toBeInTheDocument();
  });

  it("groups the table view too: one table per section, named by it", async () => {
    window.history.replaceState(null, "", "/?view=table");
    render(<Gallery />);
    // The table view loads on demand (GalleryShell's lazy GalleryTable).
    const table = await screen.findByRole("table", { name: "Tools: 3D Printing" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(screen.getByRole("table", { name: "Tools: Laser" })).toBeInTheDocument();
  });
});

describe("GalleryShell — table view", () => {
  async function openTable() {
    window.history.replaceState(null, "", "/?group=none");
    const user = userEvent.setup();
    render(<Gallery />);
    await user.click(screen.getByRole("button", { name: "Table" }));
    return { user, table: await screen.findByRole("table", { name: "Tool gallery" }) };
  }

  it("is a real table whose sort state is on the header cell, and the view is in the URL", async () => {
    const { user, table } = await openTable();
    expect(window.location.search).toBe("?view=table&group=none");
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute("aria-pressed", "true");
    expect(within(table).getAllByRole("rowheader")).toHaveLength(mockCatalog.length);

    await user.click(within(table).getByRole("button", { name: /Tool/ }));
    const header = within(table).getByRole("columnheader", { name: /Tool/ });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(table.querySelectorAll("[aria-sort]:not(th)")).toHaveLength(0);
  });

  it("shows status as glyph and word, and available units as a right-aligned number", async () => {
    const { table } = await openTable();
    const row = within(table).getByRole("row", { name: /Prusa MK4/ });
    expect(within(row).getByText("In use")).toBeInTheDocument();
    expect(within(row).getByText("/2")).toBeInTheDocument();
  });

  it("links each tool, and opens it with Enter on its row", async () => {
    const { table } = await openTable();
    expect(within(table).getByRole("link", { name: "Bandsaw" })).toHaveAttribute("href", "/tools/bandsaw");
    const row = within(table).getByRole("row", { name: /Bandsaw/ });
    row.focus();
    await userEvent.keyboard("{Enter}");
    expect(router.push).toHaveBeenCalledWith("/tools/bandsaw");
  });

  it("sorts every column, the status by how it reads", async () => {
    const { user, table } = await openTable();
    for (const name of [/Status/, /Category/, /Room/, /Training/, /Available/]) {
      await user.click(within(table).getByRole("button", { name }));
      expect(within(table).getByRole("columnheader", { name })).toHaveAttribute("aria-sort");
    }
  });

  it("offers the Columns menu, which hides and shows a column in every table", async () => {
    const { user, table } = await openTable();
    expect(within(table).queryByRole("columnheader", { name: /Official name/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Columns" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Official name" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "Training" }));
    await user.keyboard("{Escape}");
    expect(within(table).getByRole("columnheader", { name: /Official name/ })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /Training/ })).not.toBeInTheDocument();
  });

  it("is a segmented control: both segments are buttons in one named group, exactly one pressed", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    const group = screen.getByRole("group", { name: "View" });
    const [grid, tableButton] = within(group).getAllByRole("button");
    expect(grid).toHaveAttribute("aria-pressed", "true");
    expect(tableButton).toHaveAttribute("aria-pressed", "false");
    await user.click(tableButton);
    expect(grid).toHaveAttribute("aria-pressed", "false");
    expect(tableButton).toHaveAttribute("aria-pressed", "true");
  });
});
