import { render, screen, within } from "../../../test/utils/render";
import { LinkTabs } from "./LinkTabs";
import { Tile, TileCell, TileGrid, TileGroup, factGlyph, groupSpan, pairHalves } from "./Tile";

/**
 * Phase 4's navigation primitives: `LinkTabs` (tabs that are pages) and
 * `Tile` (the admin home's surface, whose unreadable count is never a zero).
 */

const pathname = vi.hoisted(() => ({ value: "/admin/intake" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.value }));

const TABS = [
  { href: "/admin/intake", label: "Queue" },
  { href: "/admin/intake/imports", label: "Imports" },
  { href: "/admin/intake/imports/new", label: "Import a list" },
];

describe("LinkTabs", () => {
  it("is navigation of links, not role=tab, with the current one marked", () => {
    pathname.value = "/admin/intake";
    render(<LinkTabs label="Add equipment" tabs={TABS} />);
    const nav = screen.getByRole("navigation", { name: "Add equipment" });
    expect(within(nav).queryByRole("tab")).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Queue" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Imports" })).not.toHaveAttribute("aria-current");
  });

  it("marks the longest match: Imports, not also Queue", () => {
    pathname.value = "/admin/intake/imports";
    render(<LinkTabs label="Add equipment" tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Imports" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Queue" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Import a list" })).not.toHaveAttribute("aria-current");
  });

  it("marks Import a list on its own page", () => {
    pathname.value = "/admin/intake/imports/new";
    render(<LinkTabs label="Add equipment" tabs={TABS} />);
    expect(screen.getByRole("link", { name: "Import a list" })).toHaveAttribute("aria-current", "page");
  });
});

describe("Tile", () => {
  it("is one link named by its title and described by its counts", () => {
    render(
      <TileGroup id="g" title="Queues" cells={1}>
        <Tile
          id="t"
          href="/admin/maintenance"
          title="Maintenance"
          value={4}
          unit="open tickets"
          waiting
          facts={[{ label: "High or critical", value: 1, tone: "bad" }]}
          series={{ values: [0, 1, 3], label: "4 tickets in 30 days", caption: "30 days" }}
        />
      </TileGroup>
    );
    const group = screen.getByRole("region", { name: "Queues" });
    const link = within(group).getByRole("link", { name: "Maintenance" });
    expect(link).toHaveAttribute("href", "/admin/maintenance");
    expect(link).toHaveAccessibleDescription(/4 open tickets.*High or critical.*1/);
    expect(link).toHaveAttribute("data-waiting", "true");
    expect(within(link).getByRole("img", { name: "4 tickets in 30 days" })).toBeInTheDocument();
  });

  it("shows zero as a zero, and not as waiting work", () => {
    render(<Tile id="t" href="/admin/projects" title="Projects" value={0} unit="waiting" waiting />);
    const link = screen.getByRole("link", { name: "Projects" });
    expect(link).toHaveTextContent("0");
    expect(link).not.toHaveAttribute("data-waiting");
  });

  it("says a count could not be read — never a 0, and no facts or trend that imply one", () => {
    render(
      <Tile
        id="t"
        href="/admin/refresh"
        title="Refresh"
        value={null}
        note="Could not be read"
        waiting
        facts={[{ label: "Running", value: 0 }]}
        series={{ values: [0, 0], label: "none", caption: "30 days" }}
      />
    );
    const link = screen.getByRole("link", { name: "Refresh" });
    expect(link).toHaveTextContent("Could not be read");
    expect(link.querySelector("[data-slot=tile-value]")).toBeNull();
    expect(link).not.toHaveTextContent("Running");
    expect(within(link).queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("Tile facts: one table, glyphs only where they mean something (DESIGN.md §8.2, §8.5)", () => {
  const facts = [
    { label: "Published — in the catalog", value: 6 },
    { label: "Running", value: 2 },
    { label: "No photo", value: 3, tone: "warn" as const },
    { label: "No manual", value: 0, tone: "warn" as const },
    { label: "High or critical", value: 5, tone: "bad" as const },
    { label: "Researching", value: 1, tone: "idle" as const },
    { label: "Handled", value: 8, tone: "ok" as const },
    { label: "Imports", value: "Could not be read", tone: "bad" as const },
  ];

  it("renders every row as glyph cell, label, value — the glyph cell present even when empty", () => {
    render(<Tile id="t" href="/admin/inventory" title="Inventory" value={4} facts={facts} />);
    const link = screen.getByRole("link", { name: "Inventory" });
    const rows = link.querySelectorAll("[data-slot=tile-fact]");
    expect(rows).toHaveLength(facts.length);
    for (const row of rows) {
      expect([...row.children].map((cell) => cell.getAttribute("data-slot"))).toEqual([
        "tile-fact-glyph",
        "tile-fact-label",
        "tile-fact-value",
      ]);
    }
    // One grid for the whole table: a fixed glyph column, the label, the value.
    const table = link.querySelector<HTMLElement>("[data-slot=tile-facts]");
    expect(table?.className).toMatch(/grid-cols-\[0\.75rem_minmax\(0,1fr\)_auto\]/);
  });

  it("draws ▲ and ■ only on non-zero rows, and nothing on neutral, in-progress, ok or zero rows", () => {
    render(<Tile id="t" href="/admin/inventory" title="Inventory" value={4} facts={facts} />);
    const link = screen.getByRole("link", { name: "Inventory" });
    const glyphOf = (label: string) => {
      const row = [...link.querySelectorAll("[data-slot=tile-fact]")].find((r) => r.textContent?.includes(label));
      return row?.querySelector("[data-glyph]")?.getAttribute("data-glyph") ?? null;
    };
    expect(glyphOf("No photo")).toBe("warn");
    expect(glyphOf("High or critical")).toBe("bad");
    expect(glyphOf("Imports")).toBe("bad");
    expect(glyphOf("No manual")).toBeNull();
    expect(glyphOf("Published")).toBeNull();
    expect(glyphOf("Running")).toBeNull();
    expect(glyphOf("Researching")).toBeNull();
    expect(glyphOf("Handled")).toBeNull();
  });

  it("mutes a zero so the non-zero counts stand out", () => {
    render(<Tile id="t" href="/admin/inventory" title="Inventory" value={4} facts={facts} />);
    const values = [...document.querySelectorAll<HTMLElement>("[data-slot=tile-fact-value]")];
    const zero = values.find((v) => v.textContent?.startsWith("0"));
    const three = values.find((v) => v.textContent?.startsWith("3"));
    expect(zero?.className).toMatch(/text-muted-foreground/);
    expect(three?.className).not.toMatch(/text-muted-foreground/);
  });

  it("factGlyph: warn, bad and active only, never on zero", () => {
    expect(factGlyph({ value: 1, tone: "warn" })).toBe("warn");
    expect(factGlyph({ value: 1, tone: "active" })).toBe("active");
    expect(factGlyph({ value: 0, tone: "bad" })).toBeNull();
    expect(factGlyph({ value: 3, tone: "idle" })).toBeNull();
    expect(factGlyph({ value: 3, tone: "ok" })).toBeNull();
    expect(factGlyph({ value: 3 })).toBeNull();
    expect(factGlyph({ value: "Could not be read", tone: "bad" })).toBe("bad");
  });
});

describe("Tile sizes and the band grid (owner, 2026-09-25)", () => {
  it("never draws a trend on a half tile", () => {
    render(
      <Tile
        id="t"
        href="/admin/users"
        title="People"
        value={4}
        unit="people have signed in"
        size="half"
        series={{ values: [1, 2], label: "trend", caption: "30 days" }}
      />
    );
    const link = screen.getByRole("link", { name: "People" });
    expect(link).toHaveAttribute("data-size", "half");
    expect(within(link).queryByRole("img")).not.toBeInTheDocument();
  });

  it("spans a group over its cells: 1 + 3 and 3 + 1 fill four columns, and a group is a full band at two", () => {
    expect(groupSpan(1, 4)).toEqual({ columns: 1, rows: 2 });
    expect(groupSpan(3, 4)).toEqual({ columns: 3, rows: 2 });
    expect(groupSpan(3, 2)).toEqual({ columns: 2, rows: 3 });
    expect(groupSpan(1, 2)).toEqual({ columns: 1, rows: 2 });
    expect(groupSpan(0, 4)).toEqual({ columns: 1, rows: 2 });
  });

  it("pairs consecutive half tiles into one cell, in order; a lone half keeps its own", () => {
    const half = (s: string) => s.startsWith("h");
    expect(pairHalves(["h1", "h2"], half)).toEqual([{ kind: "pair", items: ["h1", "h2"] }]);
    expect(pairHalves(["f1", "h1", "f2", "h2", "h3"], half)).toEqual([
      { kind: "one", item: "f1" },
      { kind: "one", item: "h1" },
      { kind: "one", item: "f2" },
      { kind: "pair", items: ["h2", "h3"] },
    ]);
  });

  it("lays a group in as a subgrid band whose heading spans it, with tiles filling their cells", () => {
    render(
      <TileGrid>
        <TileGroup id="a" title="Queues" cells={3}>
          <TileCell>
            <Tile id="m" href="/admin/maintenance" title="Maintenance" value={1} />
          </TileCell>
          <TileCell>
            <Tile id="c" href="/admin/corrections" title="Corrections" value={2} />
          </TileCell>
          <TileCell pair wide>
            <Tile id="p" href="/admin/users" title="People" value={4} size="half" />
            <Tile id="n" href="/admin/mirror" title="Mirror" value={null} note="Not connected" size="half" />
          </TileCell>
        </TileGroup>
      </TileGrid>
    );
    const group = screen.getByRole("region", { name: "Queues" });
    expect(group.className).toMatch(/sm:grid-cols-subgrid/);
    expect(group.className).toMatch(/sm:grid-rows-subgrid/);
    expect(group.style.getPropertyValue("--tile-cols-xl")).toBe("3");
    expect(group.style.getPropertyValue("--tile-rows-xl")).toBe("2");
    expect(group.style.getPropertyValue("--tile-cols-sm")).toBe("2");
    expect(group.style.getPropertyValue("--tile-rows-sm")).toBe("3");
    expect(within(group).getByRole("heading", { name: /Queues/ }).className).toMatch(/sm:col-span-full/);
    const cells = group.querySelectorAll<HTMLElement>("[data-slot=tile-cell]");
    expect(cells).toHaveLength(3);
    // The odd last cell spans both columns at two, one at four; its halves share it.
    expect(cells[2].className).toMatch(/sm:col-span-2/);
    expect(cells[2].className).toMatch(/xl:col-span-1/);
    expect(cells[2].querySelectorAll("[data-slot=tile]")).toHaveLength(2);
    // Every tile fills its cell, so tiles in one row share their top and bottom edges.
    for (const tile of group.querySelectorAll<HTMLElement>("[data-slot=tile]")) expect(tile.className).toMatch(/\bh-full\b/);
  });
});
