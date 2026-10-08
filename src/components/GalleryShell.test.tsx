import { useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { render, screen, within, userEvent } from "../../test/utils/render";
import { GalleryShell } from "./GalleryShell";
import { mockCatalog } from "../../test/fixtures/catalog";
import type { MakerLabTool } from "./catalog-types";
import { useChatLauncher } from "./ChatLauncherContext";
import { GALLERY_DEFAULT_HIDDEN, useGalleryColumns } from "./gallery-columns";
import { useCatalogueState } from "./use-catalogue-state";

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// Render Next's image/link as plain elements for deterministic, router-free
// component tests. GalleryShell renders tiles, ToolCard (grid) and a DataTable (table).
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
 * The home page's content under the search (UI system phase 5a; student home
 * spec 2026-10-07, amendment "One page: the list at rest", revised): the
 * category tiles, a category's tools with the way back, all tools grouped by
 * category, and the results while searching — every choice in the URL. The
 * controls are the Filters panel's (FiltersPanel.test.tsx); here the state
 * arrives in the URL.
 */

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  router.push.mockReset();
});

/** The content wired to the URL as the home page wires it. */
function Gallery({ tools = mockCatalog, categoryOrder = [] }: { tools?: MakerLabTool[]; categoryOrder?: string[] }) {
  const { state, set, view } = useCatalogueState(tools, categoryOrder);
  const columns = useGalleryColumns();
  const [visibility] = useState<VisibilityState>(GALLERY_DEFAULT_HIDDEN);
  return <GalleryShell state={state} set={set} view={view} columns={columns} visibility={visibility} />;
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

function cardNames(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="tool-card"]')).map(
    (card) => within(card as HTMLElement).getByRole("heading").textContent ?? ""
  );
}

function sectionLabels(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2 > span:first-child')).map((el) => el.textContent ?? "");
}

function tileNames(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="category-tile"]')).map(
    (tile) => within(tile as HTMLElement).getByRole("heading", { level: 2 }).textContent ?? ""
  );
}

describe("GalleryShell — Categories (the default)", () => {
  it("shows one tile per category in the lab's order, with counts and units down, and no tools", () => {
    render(<Gallery categoryOrder={["Laser", "3D Printing", "Woodworking"]} />);
    expect(tileNames()).toEqual(["Laser", "3D Printing", "Woodworking"]);
    const tiles = within(screen.getByRole("list", { name: "Categories" })).getAllByRole("link");
    expect(tiles[1]).toHaveTextContent("2 tools");
    expect(tiles[0]).toHaveTextContent("1 unit out of service");
    expect(tiles[0]).toHaveAttribute("href", "/?category=Laser");
    expect(cardNames()).toEqual([]);
  });

  it("opens a category's tools in place from its tile, as a new history entry, with the way back", async () => {
    const user = userEvent.setup();
    const before = window.history.length;
    render(<Gallery />);
    await user.click(screen.getByRole("link", { name: /3D Printing/ }));
    expect(window.location.search).toBe("?category=3D+Printing");
    expect(window.history.length).toBe(before + 1);
    expect(screen.getByRole("heading", { level: 2, name: "3D Printing" })).toBeInTheDocument();
    expect(screen.getByText("2 tools")).toBeInTheDocument();
    expect(cardNames().sort()).toEqual(["Form 4", "Prusa MK4"]);
    // Cards sit under the category's h2.
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent).sort()).toEqual(["Form 4", "Prusa MK4"]);

    await user.click(screen.getByRole("button", { name: "All categories" }));
    expect(window.location.search).toBe("");
    expect(tileNames()).toHaveLength(3);
  });

  it("leaves a modified click to the browser (a new tab), not the page", async () => {
    const user = userEvent.setup();
    render(<Gallery />);
    await user.keyboard("{Meta>}");
    await user.click(screen.getByRole("link", { name: /Laser/ }));
    await user.keyboard("{/Meta}");
    expect(window.location.search).toBe("");
  });

  it("opens a category named in the URL (a tool page's category link), the hidden-by-default one included", () => {
    const tools = mockCatalog.map((tool) =>
      tool.slug === "bandsaw" ? { ...tool, category: "Shop Infrastructure & Supplies", galleryHidden: true } : tool
    );
    window.history.replaceState(null, "", "/?category=Shop%20Infrastructure%20%26%20Supplies");
    render(<Gallery tools={tools} />);
    expect(screen.getByRole("heading", { level: 2, name: "Shop Infrastructure & Supplies" })).toBeInTheDocument();
    expect(cardNames()).toEqual(["Bandsaw"]);
  });

  it("gives a hidden-by-default category no tile", () => {
    const tools = mockCatalog.map((tool) =>
      tool.slug === "bandsaw" ? { ...tool, category: "Shop Infrastructure & Supplies", galleryHidden: true } : tool
    );
    render(<Gallery tools={tools} />);
    expect(tileNames()).toEqual(["3D Printing", "Laser"]);
  });

  it("counts the tiles under the other filters, and drops a category they empty", () => {
    window.history.replaceState(null, "", "/?status=Available");
    render(<Gallery />);
    expect(tileNames()).toEqual(["3D Printing", "Woodworking"]);
    expect(screen.getByRole("link", { name: /3D Printing/ })).toHaveTextContent("1 tool");
  });
});

describe("GalleryShell — All tools", () => {
  it("groups every tool by category, alphabetically without the lab's order, each heading with its count", () => {
    window.history.replaceState(null, "", "/?show=all");
    render(<Gallery />);
    expect(sectionLabels()).toEqual(["3D Printing", "Laser", "Woodworking"]);
    const headings = Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2')).map((h) => h.textContent);
    expect(headings).toEqual(["3D Printing2 tools", "Laser1 tool", "Woodworking1 tool"]);
    const printing = screen.getByRole("region", { name: /3D Printing/ });
    expect(within(printing).getAllByRole("heading", { level: 3 }).map((h) => h.textContent).sort()).toEqual(["Form 4", "Prusa MK4"]);
    // The heading sticks under the top bar while its section scrolls.
    expect(printing.querySelector("h2")!.className).toMatch(/sticky/);
  });

  it("follows the lab's category order", () => {
    window.history.replaceState(null, "", "/?show=all");
    render(<Gallery categoryOrder={["Woodworking", "Laser", "3D Printing"]} />);
    expect(sectionLabels()).toEqual(["Woodworking", "Laser", "3D Printing"]);
    expect(cardNames()).toEqual(["Bandsaw", "Trotec Speedy 400", "Prusa MK4", "Form 4"]);
  });

  it("reads its filters from the URL (a view is a link), dropping what it does not offer", () => {
    window.history.replaceState(null, "", "/?show=all&location=MakerLab&view=grid&sort=bogus");
    render(<Gallery />);
    expect(cardNames().sort()).toEqual(["Form 4", "Prusa MK4"]);
  });

  it("is one list with h2 cards when grouping is none", () => {
    window.history.replaceState(null, "", "/?show=all&group=none");
    render(<Gallery />);
    expect(document.querySelector('[data-slot="gallery-section"]')).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).sort()).toEqual(
      ["Bandsaw", "Form 4", "Prusa MK4", "Trotec Speedy 400"]
    );
  });

  it("groups by subcategory within its category, and by location", () => {
    window.history.replaceState(null, "", "/?show=all&group=category");
    const { unmount } = render(<Gallery />);
    expect(sectionLabels()).toEqual(["3D Printing › FDM", "3D Printing › Resin", "Laser › CO2", "Woodworking › Cutting"]);
    unmount();

    window.history.replaceState(null, "", "/?show=all&group=location");
    render(<Gallery />);
    expect(sectionLabels()).toEqual(["Laser Room", "MakerLab", "Wood Shop"]);
  });

  it("reads an old link's ?group=categoryGroup as the default", () => {
    window.history.replaceState(null, "", "/?show=all&group=categoryGroup");
    render(<Gallery />);
    expect(sectionLabels()).toEqual(["3D Printing", "Laser", "Woodworking"]);
  });

  it("sorts: the catalogue's order by default, then Z–A, recently added and availability", () => {
    window.history.replaceState(null, "", "/?show=all&group=none");
    const { unmount } = render(<Gallery tools={DATED} />);
    expect(cardNames()).toEqual(DATED.map((tool) => tool.name));
    unmount();
    for (const [sort, expected] of [
      ["name-desc", ["Trotec Speedy 400", "Prusa MK4", "Form 4", "Bandsaw"]],
      ["recent", ["Form 4", "Trotec Speedy 400", "Prusa MK4", "Bandsaw"]],
    ] as const) {
      window.history.replaceState(null, "", `/?show=all&group=none&sort=${sort}`);
      const view = render(<Gallery tools={DATED} />);
      expect(cardNames()).toEqual(expected);
      view.unmount();
    }
    window.history.replaceState(null, "", "/?show=all&group=none&sort=available");
    render(<Gallery tools={DATED} />);
    // The Trotec's only unit is offline: nothing to walk up to, so it sorts last.
    expect(cardNames().at(-1)).toBe("Trotec Speedy 400");
  });

  it("applies the sort inside every section", () => {
    window.history.replaceState(null, "", "/?show=all&sort=name-desc");
    render(<Gallery />);
    expect(cardNames()).toEqual(["Prusa MK4", "Form 4", "Trotec Speedy 400", "Bandsaw"]);
  });

  it("groups the table view too: one table per section, named by it", async () => {
    window.history.replaceState(null, "", "/?show=all&view=table");
    render(<Gallery />);
    // The table view loads on demand (GalleryShell's lazy GalleryTable).
    const table = await screen.findByRole("table", { name: "Tools: 3D Printing" });
    expect(within(table).getAllByRole("rowheader")).toHaveLength(2);
    expect(screen.getByRole("table", { name: "Tools: Laser" })).toBeInTheDocument();
  });
});

describe("GalleryShell — the table", () => {
  async function openTable() {
    window.history.replaceState(null, "", "/?show=all&group=none&view=table");
    const user = userEvent.setup();
    render(<Gallery />);
    return { user, table: await screen.findByRole("table", { name: "Tool gallery" }) };
  }

  it("is a real table whose sort state is on the header cell", async () => {
    const { user, table } = await openTable();
    expect(within(table).getAllByRole("rowheader")).toHaveLength(mockCatalog.length);
    await user.click(within(table).getByRole("button", { name: /Tool/ }));
    expect(within(table).getByRole("columnheader", { name: /Tool/ })).toHaveAttribute("aria-sort", "ascending");
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
    within(table).getByRole("row", { name: /Bandsaw/ }).focus();
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
});

describe("GalleryShell — searching, in either view", () => {
  it("swaps the tiles for the matching tools, best match first, under a heading that names the search", () => {
    window.history.replaceState(null, "", "/?q=prusa");
    render(<Gallery />);
    expect(tileNames()).toEqual([]);
    const results = screen.getByRole("region", { name: /Results for “prusa”/ });
    expect(within(results).getByRole("heading", { level: 2 })).toHaveTextContent("1 tool");
    expect(cardNames()).toEqual(["Prusa MK4"]);
  });

  it("swaps the groups for the results in All tools too", () => {
    window.history.replaceState(null, "", "/?show=all&q=acrylic");
    render(<Gallery />);
    expect(sectionLabels()).toEqual([]);
    // Acrylic is one of the Trotec's materials; its name does not say it.
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
    expect(window.location.search).toBe("");
    expect(tileNames()).toHaveLength(3);
  });

  it("shows the results as one table in the table view", async () => {
    window.history.replaceState(null, "", "/?q=o&view=table");
    render(<Gallery />);
    const table = await screen.findByRole("table", { name: "Results for “o”" });
    expect(within(table).getAllByRole("rowheader").length).toBeGreaterThan(1);
  });
});
