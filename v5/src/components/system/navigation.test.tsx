import { render, screen, within } from "../../../test/utils/render";
import { LinkTabs } from "./LinkTabs";
import { Tile, TileCell, TileGrid, TileGroup, tileRows } from "./Tile";

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
      <TileGroup id="g" title="Queues">
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

describe("Tile sizes and the row grid (owner, 2026-09-25)", () => {
  it("takes two row tracks, or one for a half tile, and never draws a trend on a half tile", () => {
    expect(tileRows("full")).toBe(2);
    expect(tileRows(undefined)).toBe(2);
    expect(tileRows("half")).toBe(1);
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

  it("lays each group over the same number of rows, and each tile over its own span", () => {
    render(
      <TileGrid>
        <TileGroup id="a" title="Settings" rows={5}>
          <TileCell size="half">
            <Tile id="p" href="/admin/users" title="People" value={4} size="half" />
          </TileCell>
          <TileCell size="full">
            <Tile id="m" href="/admin/maintenance" title="Maintenance" value={1} />
          </TileCell>
        </TileGroup>
      </TileGrid>
    );
    const group = screen.getByRole("region", { name: "Settings" });
    expect(group.style.gridRow).toBe("span 5 / span 5");
    const cells = group.querySelectorAll<HTMLElement>("[data-slot=tile-cell]");
    expect([...cells].map((cell) => cell.style.gridRow)).toEqual(["span 1 / span 1", "span 2 / span 2"]);
    // The tile fills its cell, so tiles in one row share their top and bottom edges.
    expect(within(group).getByRole("link", { name: "People" }).className).toMatch(/\bh-full\b/);
  });
});
