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

  it("filters by category facet (single-select chip)", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // Two tools are in "3D Printing": Prusa MK4 and Form 4.
    await user.click(screen.getByRole("button", { name: "3D Printing" }));

    const names = cardNames();
    expect(names).toEqual(
      expect.arrayContaining(["Prusa MK4", "Form 4"])
    );
    expect(names).not.toContain("Bandsaw");
    expect(names).not.toContain("Trotec Speedy 400");
  });

  it("filters by material facet", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // "PLA" is a material only on the Prusa MK4.
    await user.click(screen.getByRole("button", { name: "PLA" }));

    expect(cardNames()).toEqual(["Prusa MK4"]);
  });

  it("filters by location facet", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // "Laser Room" is the location of the Trotec Speedy 400 only.
    await user.click(screen.getByRole("button", { name: "Laser Room" }));

    expect(cardNames()).toEqual(["Trotec Speedy 400"]);
  });

  it("combines facets with AND and falls to empty state when none match", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    // Category "Woodworking" (Bandsaw) AND training "Advanced" (Trotec) — no
    // tool satisfies both, so the empty state appears.
    await user.click(screen.getByRole("button", { name: "Woodworking" }));
    await user.click(screen.getByRole("button", { name: "Advanced" }));

    expect(screen.getByText("No matching tools found.")).toBeInTheDocument();
  });

  it("toggles a category chip off to restore the full grid", async () => {
    const user = userEvent.setup();
    render(<GalleryShell tools={mockCatalog} />);

    const woodworking = screen.getByRole("button", { name: "Woodworking" });
    await user.click(woodworking);
    expect(cardNames()).toEqual(["Bandsaw"]);

    await user.click(woodworking);
    expect(cardNames()).toHaveLength(mockCatalog.length);
  });
});
