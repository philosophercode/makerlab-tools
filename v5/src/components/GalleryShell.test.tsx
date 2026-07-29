import { render, screen, within, userEvent } from "../../test/utils/render";
import { GalleryShell } from "./GalleryShell";
import { mockCatalog } from "../../test/fixtures/catalog";

// Render Next's image/link as plain elements for deterministic, router-free
// component tests. GalleryShell renders ToolCard (grid) and <a> rows (table).
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/** The card grid is the section labeled "Tool gallery"; cards are links. */
function getGridCards() {
  const grid = screen.getByRole("region", { name: "Tool gallery" });
  return within(grid).getAllByRole("link");
}

function cardNames() {
  return getGridCards().map((link) =>
    within(link).getByRole("heading").textContent
  );
}

/**
 * Category and Materials are collapsible multi-select dropdowns: a labelled
 * group holds an `aria-expanded` toggle that reveals a listbox of options.
 * Open the named facet and hand back its group for option queries.
 */
async function openFacet(
  user: ReturnType<typeof userEvent.setup>,
  groupLabel: string
) {
  const group = screen.getByRole("group", { name: groupLabel });
  await user.click(within(group).getByRole("button", { expanded: false }));
  return group;
}

/** Click one option inside an already-open facet dropdown. */
async function clickOption(
  user: ReturnType<typeof userEvent.setup>,
  group: HTMLElement,
  name: string
) {
  await user.click(within(group).getByRole("option", { name }));
}

describe("GalleryShell", () => {
  it("renders one card per tool in the catalog", () => {
    render(<GalleryShell tools={mockCatalog} />);

    const names = cardNames();
    expect(names).toHaveLength(mockCatalog.length);
    expect(names).toEqual(
      expect.arrayContaining([
        "Bandsaw",
        "Prusa MK4",
        "Trotec Speedy 400",
        "Form 4",
      ])
    );
  });

  it("renders the gallery title and search input", () => {
    render(<GalleryShell tools={mockCatalog} />);

    expect(
      screen.getByRole("heading", { name: "TOOLS // MACHINES" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Search inventory" })
    ).toBeInTheDocument();
  });

  it("filters cards by name as the user types", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const search = screen.getByRole("textbox", { name: "Search inventory" });
    await user.type(search, "Prusa");

    // match-sorter is fuzzy and ranked: the exact name match (Prusa MK4) ranks
    // first, and clearly-unrelated tools (Bandsaw) drop out. Some weak fuzzy
    // matches against the longer free-text keys may survive, so assert the top
    // result and the exclusion rather than an exact-length equality.
    const names = cardNames();
    expect(names[0]).toBe("Prusa MK4");
    expect(names).not.toContain("Bandsaw");
  });

  it("filters by tag/material text via fuzzy search", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const search = screen.getByRole("textbox", { name: "Search inventory" });
    // "Acrylic" is a material only on the Trotec Speedy 400.
    await user.type(search, "Acrylic");

    const names = cardNames();
    expect(names).toContain("Trotec Speedy 400");
    expect(names).not.toContain("Bandsaw");
  });

  it("shows the empty state when nothing matches the query", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const search = screen.getByRole("textbox", { name: "Search inventory" });
    await user.type(search, "zzz-no-such-tool-zzz");

    expect(screen.getByText("No matching tools found.")).toBeInTheDocument();
    const grid = screen.getByRole("region", { name: "Tool gallery" });
    expect(within(grid).queryAllByRole("link")).toHaveLength(0);
  });

  it("filters by category facet", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // Two tools are in "3D Printing": Prusa MK4 and Form 4.
    const category = await openFacet(user, "CATEGORY:");
    await clickOption(user, category, "3D Printing");

    const names = cardNames();
    expect(names).toEqual(
      expect.arrayContaining(["Prusa MK4", "Form 4"])
    );
    expect(names).not.toContain("Bandsaw");
    expect(names).not.toContain("Trotec Speedy 400");
    // Selection state is exposed to assistive tech, not just to CSS.
    expect(
      within(category).getByRole("option", { name: "3D Printing" })
    ).toHaveAttribute("aria-selected", "true");
  });

  it("selects multiple categories, OR-ing within the facet", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const category = await openFacet(user, "CATEGORY:");
    await clickOption(user, category, "3D Printing");
    await clickOption(user, category, "Woodworking");

    const names = cardNames();
    expect(names).toEqual(
      expect.arrayContaining(["Prusa MK4", "Form 4", "Bandsaw"])
    );
    expect(names).not.toContain("Trotec Speedy 400");
  });

  it("filters by material facet", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // "PLA" is a material only on the Prusa MK4.
    const materials = await openFacet(user, "MATERIALS:");
    await clickOption(user, materials, "PLA");

    expect(cardNames()).toEqual(["Prusa MK4"]);
  });

  it("selects a whole material group from its heading", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // "Wood" groups Plywood + Hardwood: the Bandsaw and the Trotec both cut
    // plywood, the printers do not.
    const materials = await openFacet(user, "MATERIALS:");
    await user.click(within(materials).getByRole("button", { name: "Wood" }));

    const names = cardNames();
    expect(names).toEqual(
      expect.arrayContaining(["Bandsaw", "Trotec Speedy 400"])
    );
    expect(names).not.toContain("Prusa MK4");
  });

  it("filters by the location select", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // "Laser Room" is the location of the Trotec Speedy 400 only.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "LOCATION:" }),
      "Laser Room"
    );

    expect(cardNames()).toEqual(["Trotec Speedy 400"]);
  });

  it("combines facets with AND and falls to empty state when none match", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // Category "Woodworking" (Bandsaw) AND material "PLA" (Prusa) — no tool
    // satisfies both, so the facets AND down to the empty state.
    const category = await openFacet(user, "CATEGORY:");
    await clickOption(user, category, "Woodworking");

    const materials = await openFacet(user, "MATERIALS:");
    await clickOption(user, materials, "PLA");

    expect(screen.getByText("No matching tools found.")).toBeInTheDocument();
  });

  it("toggles a category option off to restore the full grid", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const category = await openFacet(user, "CATEGORY:");
    await clickOption(user, category, "Woodworking");
    expect(cardNames()).toEqual(["Bandsaw"]);

    await clickOption(user, category, "Woodworking");
    expect(cardNames()).toHaveLength(mockCatalog.length);
  });

  it("clears every facet from the Clear button", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const category = await openFacet(user, "CATEGORY:");
    await clickOption(user, category, "Woodworking");
    expect(cardNames()).toEqual(["Bandsaw"]);

    await user.click(screen.getByRole("button", { name: "Clear 1" }));

    expect(cardNames()).toHaveLength(mockCatalog.length);
  });
});
