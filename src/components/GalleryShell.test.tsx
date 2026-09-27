import { render, screen, within, userEvent } from "../../test/utils/render";
import { GalleryShell } from "./GalleryShell";
import { mockCatalog } from "../../test/fixtures/catalog";
import type { MakerLabTool } from "./catalog-types";

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
 * The gallery (UI system phase 5a): the FilterBar console, Sort and Group by
 * (owner request 2026-09-25), grid and table, every choice in the URL.
 */

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

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

function searchBox() {
  return screen.getByRole("searchbox", { name: "Search inventory" });
}

async function pick(user: ReturnType<typeof userEvent.setup>, control: string, value: RegExp) {
  await user.click(within(screen.getByRole("search")).getByRole("button", { name: new RegExp(`^${control}`) }));
  await user.click(await screen.findByRole("menuitemradio", { name: value }));
}

describe("GalleryShell — search and facets", () => {
  it("renders one card per tool, the title and a facts line", () => {
    render(<GalleryShell tools={mockCatalog} />);
    expect(cardNames()).toHaveLength(mockCatalog.length);
    expect(screen.getByRole("heading", { level: 1, name: "TOOLS // MACHINES" })).toBeInTheDocument();
    expect(screen.getByText(/4 tools · \d+ available now · 3 categories/)).toBeInTheDocument();
    expect(searchBox()).toBeInTheDocument();
  });

  it("filters cards by name as the user types, best match first, and writes ?q=", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.type(searchBox(), "Prusa");
    const names = cardNames();
    expect(names[0]).toBe("Prusa MK4");
    expect(names).not.toContain("Bandsaw");
    expect(window.location.search).toBe("?q=Prusa");
  });

  it("keeps a space typed into the search (the URL is not trimmed under the cursor)", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.type(searchBox(), "Form ");
    expect(searchBox()).toHaveValue("Form ");
  });

  it("filters by a category facet whose menu counts each value", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.click(within(screen.getByRole("search")).getByRole("button", { name: /^Category/ }));
    expect(await screen.findByRole("menuitemradio", { name: /3D Printing/ })).toHaveTextContent("2");
    await user.click(screen.getByRole("menuitemradio", { name: /3D Printing/ }));
    expect(cardNames().sort()).toEqual(["Form 4", "Prusa MK4"]);
    expect(within(screen.getByRole("search")).getByRole("button", { name: "Category: 3D Printing" })).toBeInTheDocument();
    expect(window.location.search).toBe("?category=3D+Printing");
  });

  it("filters by material and by location", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await pick(user, "Material", /^PLA/);
    expect(cardNames()).toEqual(["Prusa MK4"]);
    await user.click(within(screen.getByRole("search")).getByRole("button", { name: "Clear filters" }));
    await pick(user, "Location", /Laser Room/);
    expect(cardNames()).toEqual(["Trotec Speedy 400"]);
  });

  it("names the filters that emptied the gallery, with Clear", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.type(searchBox(), "zzz-no-such-tool");
    expect(screen.getByText('No tools match "zzz-no-such-tool".')).toBeInTheDocument();
    await user.click(within(screen.getByRole("region", { name: "Tool gallery" })).getByRole("button", { name: "Clear filters" }));
    expect(cardNames()).toHaveLength(mockCatalog.length);
    expect(window.location.search).toBe("");
  });

  it("reads its filters from the URL (a view is a link)", () => {
    window.history.replaceState(null, "", "/?location=MakerLab&view=grid&sort=bogus");
    render(<GalleryShell tools={mockCatalog} />);
    expect(cardNames().sort()).toEqual(["Form 4", "Prusa MK4"]);
    // An unknown sort is dropped, not an error.
    expect(within(screen.getByRole("search")).getByRole("button", { name: "Sort: Name A–Z" })).toBeInTheDocument();
  });
});

describe("GalleryShell — sort", () => {
  it("sorts Z–A, by recently added and by availability, and writes ?sort=", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={DATED} />);
    // The default is the catalogue's own order (the database's name order).
    expect(cardNames()).toEqual(DATED.map((tool) => tool.name));

    await pick(user, "Sort", /Name Z–A/);
    expect(cardNames()).toEqual(["Trotec Speedy 400", "Prusa MK4", "Form 4", "Bandsaw"]);
    expect(window.location.search).toBe("?sort=name-desc");

    await pick(user, "Sort", /Recently added/);
    expect(cardNames()).toEqual(["Form 4", "Trotec Speedy 400", "Prusa MK4", "Bandsaw"]);

    await pick(user, "Sort", /Most available/);
    // The Trotec's only unit is offline: nothing to walk up to, so it sorts last.
    expect(cardNames().at(-1)).toBe("Trotec Speedy 400");

    await pick(user, "Sort", /Name A–Z/);
    expect(window.location.search).toBe("");
  });

  it("calls the default 'Best match' while searching", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.type(searchBox(), "resin");
    expect(within(screen.getByRole("search")).getByRole("button", { name: "Sort: Best match" })).toBeInTheDocument();
  });
});

describe("GalleryShell — group by", () => {
  it("shows labelled sections in order, each with its count, and writes ?group=", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await pick(user, "Group by", /^Category group/);

    const sections = document.querySelectorAll('[data-slot="gallery-section"]');
    const headings = Array.from(sections).map((section) => within(section as HTMLElement).getByRole("heading", { level: 2 }));
    expect(headings.map((heading) => heading.textContent)).toEqual(["3D Printing2 tools", "Laser1 tool", "Woodworking1 tool"]);
    // Each section is a region named by its heading; cards drop to h3 beneath it.
    const printing = screen.getByRole("region", { name: /3D Printing/ });
    expect(within(printing).getAllByRole("heading", { level: 3 }).map((h) => h.textContent).sort()).toEqual(["Form 4", "Prusa MK4"]);
    expect(window.location.search).toBe("?group=categoryGroup");
    // The heading sticks under the top bar while its section scrolls.
    expect(headings[0].className).toMatch(/sticky/);
  });

  it("groups by category within its group, and by location", async () => {
    window.history.replaceState(null, "", "/?group=category");
    const { unmount } = render(<GalleryShell tools={mockCatalog} />);
    const labels = () =>
      Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2 > span:first-child')).map((el) => el.textContent);
    expect(labels()).toEqual(["3D Printing › FDM", "3D Printing › Resin", "Laser › CO2", "Woodworking › Cutting"]);
    unmount();

    window.history.replaceState(null, "", "/?group=location");
    render(<GalleryShell tools={mockCatalog} />);
    expect(labels()).toEqual(["Laser Room", "MakerLab", "Wood Shop"]);
  });

  it("applies the sort inside every section", () => {
    window.history.replaceState(null, "", "/?group=categoryGroup&sort=name-desc");
    render(<GalleryShell tools={mockCatalog} />);
    expect(cardNames()).toEqual(["Prusa MK4", "Form 4", "Trotec Speedy 400", "Bandsaw"]);
  });

  it("groups the table view too: one table per section, named by it", () => {
    window.history.replaceState(null, "", "/?group=categoryGroup&view=table");
    render(<GalleryShell tools={mockCatalog} />);
    const table = screen.getByRole("table", { name: "Tools: 3D Printing" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(screen.getByRole("table", { name: "Tools: Laser" })).toBeInTheDocument();
  });
});

describe("GalleryShell — table view", () => {
  async function openTable() {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.click(screen.getByRole("button", { name: "Table" }));
    return { user, table: screen.getByRole("table", { name: "Tool gallery" }) };
  }

  it("is a real table whose sort state is on the header cell, and the view is in the URL", async () => {
    const { user, table } = await openTable();
    expect(window.location.search).toBe("?view=table");
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
});

describe("GalleryShell — status facet and view switch", () => {
  it("filters by status with counts, writes ?status=, and the same filter drives the grid and the table", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    await user.click(within(screen.getByRole("search")).getByRole("button", { name: /^Status/ }));
    const item = await screen.findByRole("menuitemradio", { name: /In use/ });
    expect(item).toHaveTextContent(/\d/);
    await user.click(item);
    expect(window.location.search).toBe("?status=In+Use");
    expect(cardNames()).toEqual(expect.arrayContaining(["Prusa MK4"]));
    expect(cardNames()).not.toContain("Bandsaw");

    await user.click(screen.getByRole("button", { name: "Table" }));
    const table = screen.getByRole("table", { name: "Tool gallery" });
    expect(within(table).queryByRole("row", { name: /Bandsaw/ })).not.toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /Prusa MK4/ })).toBeInTheDocument();
  });

  it("is a segmented control: both segments are buttons in one named group, exactly one pressed", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    const group = screen.getByRole("group", { name: "View" });
    const [grid, tableButton] = within(group).getAllByRole("button");
    expect(grid).toHaveAttribute("aria-pressed", "true");
    expect(tableButton).toHaveAttribute("aria-pressed", "false");
    await user.click(tableButton);
    expect(grid).toHaveAttribute("aria-pressed", "false");
    expect(tableButton).toHaveAttribute("aria-pressed", "true");
  });

  it("puts the facets behind a Filters button that says how many are set", async () => {
    window.history.replaceState(null, "", "/?status=Available&location=MakerLab");
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);
    const filters = await screen.findByRole("button", { name: "Filters, 2 set" });
    await user.click(filters);
    const sheet = await screen.findByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("button", { name: /^Status/ })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^Group by/ })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /^Show \d+ results?/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
