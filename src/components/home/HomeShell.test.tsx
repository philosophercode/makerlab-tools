import { render, screen, within } from "../../../test/utils/render";
import { mockCatalog } from "../../../test/fixtures/catalog";
import { HomeShell } from "./HomeShell";
import { toHomeTool } from "./home-tools";

/**
 * The student home (student home spec 2026-10-07; review option B with the
 * owner's addendum): the smart search, then "Tools" and the category tiles,
 * then the way to the full list. No big wordmark: the logo is the header's
 * alone (amendment "The logo once").
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const tools = mockCatalog.map(toHomeTool);

it("is titled Tools, with one search box above it and no second wordmark", () => {
  render(<HomeShell tools={tools} categoryOrder={[]} />);
  expect(screen.getByRole("heading", { level: 1, name: "Tools" })).toBeInTheDocument();
  expect(document.querySelector('[data-slot="home-wordmark"]')).toBeNull();
  expect(screen.getAllByRole("search")).toHaveLength(1);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
});

it("says none of the copy the owner removed", () => {
  const { container } = render(<HomeShell tools={tools} categoryOrder={[]} />);
  expect(container.textContent).not.toMatch(/what do you want to make/i);
  expect(container.textContent).not.toMatch(/kinds of making/i);
  expect(container.textContent).not.toMatch(/start here/i);
});

it("lists one tile per category in the lab's order, each linking to the filtered list", () => {
  render(<HomeShell tools={tools} categoryOrder={["Laser", "3D Printing", "Woodworking"]} />);
  const tiles = within(screen.getByRole("list", { name: "Tools" })).getAllByRole("link");
  expect(tiles.map((tile) => within(tile).getByRole("heading", { level: 2 }).textContent)).toEqual(["Laser", "3D Printing", "Woodworking"]);
  expect(tiles[0]).toHaveAttribute("href", "/tools?category=Laser");
  expect(tiles[1]).toHaveAttribute("href", "/tools?category=3D+Printing");
  expect(tiles[1]).toHaveTextContent("2 tools");
  expect(tiles[0]).toHaveTextContent("1 unit out of service");
  expect(tiles[1]).not.toHaveTextContent("out of service");
});

it("offers the full list with its live count", () => {
  render(<HomeShell tools={tools} categoryOrder={[]} />);
  const links = screen.getAllByRole("link", { name: /See all 4 tools/ });
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) expect(link).toHaveAttribute("href", "/tools");
});
