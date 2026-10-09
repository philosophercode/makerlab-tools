import { useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { render, screen, within, userEvent } from "../../../test/utils/render";
import { mockCatalog } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";
import { GalleryShell } from "../GalleryShell";
import { GALLERY_DEFAULT_HIDDEN, useGalleryColumns } from "../gallery-columns";
import { useCatalogueState } from "../use-catalogue-state";
import { FiltersPanel } from "./FiltersPanel";

/**
 * The home page's Filters panel (student home spec, amendment "One page: the
 * list at rest", revised): every control the list has — Category (a menu),
 * Status, Material, Location, Item kind, Group by, Sort, Grid / Table — the
 * count, and Clear while a filter is set. Shown open here; its button and
 * when it opens are HomeShell.test.tsx's.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
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

beforeEach(() => window.history.replaceState(null, "", "/?show=all"));

function Page({ tools = mockCatalog, categoryOrder = [], open = true }: { tools?: MakerLabTool[]; categoryOrder?: string[]; open?: boolean }) {
  const { state, set, view } = useCatalogueState(tools, categoryOrder);
  const columns = useGalleryColumns();
  const [visibility, setVisibility] = useState<VisibilityState>(GALLERY_DEFAULT_HIDDEN);
  return (
    <>
      <FiltersPanel
        id="filters"
        open={open}
        tools={tools}
        state={state}
        set={set}
        view={view}
        categoryOrder={categoryOrder}
        columns={columns}
        visibility={visibility}
        onVisibility={setVisibility}
      />
      <GalleryShell state={state} set={set} view={view} columns={columns} visibility={visibility} />
    </>
  );
}

function panel() {
  return screen.getByRole("search", { name: "Filter the tools" });
}

function cardNames(): string[] {
  return Array.from(document.querySelectorAll('[data-slot="tool-card"]')).map(
    (card) => within(card as HTMLElement).getByRole("heading").textContent ?? ""
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, control: string, value: RegExp) {
  await user.click(within(panel()).getByRole("button", { name: new RegExp(`^${control}`) }));
  await user.click(await screen.findByRole("menuitemradio", { name: value }));
}

it("is hidden, not gone, while closed", () => {
  render(<Page open={false} />);
  expect(screen.queryByRole("search", { name: "Filter the tools" })).not.toBeInTheDocument();
  expect(document.getElementById("filters")).toHaveAttribute("hidden");
});

it("offers Category as a menu in the lab's order with counts, hidden-by-default last", async () => {
  const user = userEvent.setup();
  const tools = mockCatalog.map((tool) => (tool.slug === "bandsaw" ? { ...tool, category: "Supplies", galleryHidden: true } : tool));
  render(<Page tools={tools} categoryOrder={["Supplies", "Laser", "3D Printing"]} />);
  await user.click(within(panel()).getByRole("button", { name: /^Category/ }));
  const items = await screen.findAllByRole("menuitemradio");
  expect(items.map((item) => item.textContent)).toEqual(["Any", "Laser1", "3D Printing2", "Supplies1"]);
  await user.click(screen.getByRole("menuitemradio", { name: /3D Printing/ }));
  expect(window.location.search).toBe("?show=all&category=3D+Printing");
  expect(cardNames().sort()).toEqual(["Form 4", "Prusa MK4"]);
  expect(within(panel()).getByRole("button", { name: "Category: 3D Printing" })).toBeInTheDocument();
});

it("filters by status with counts, material, location and item kind, each in the URL", async () => {
  const user = userEvent.setup();
  render(<Page />);
  await user.click(within(panel()).getByRole("button", { name: /^Status/ }));
  expect(await screen.findByRole("menuitemradio", { name: /In use/ })).toHaveTextContent(/\d/);
  await user.click(screen.getByRole("menuitemradio", { name: /In use/ }));
  expect(window.location.search).toBe("?show=all&status=In+Use");
  expect(cardNames()).toEqual(["Prusa MK4"]);

  await user.click(within(panel()).getByRole("button", { name: "Clear filters" }));
  await pick(user, "Material", /^PLA/);
  expect(cardNames()).toEqual(["Prusa MK4"]);
  await user.click(within(panel()).getByRole("button", { name: "Clear filters" }));
  await pick(user, "Location", /Laser Room/);
  expect(cardNames()).toEqual(["Trotec Speedy 400"]);
  await user.click(within(panel()).getByRole("button", { name: "Clear filters" }));
  await pick(user, "Item kind", /Equipment/);
  expect(window.location.search).toBe("?show=all&kind=equipment");
});

it("states the count it leaves, and offers Clear only while a filter is set", async () => {
  const user = userEvent.setup();
  render(<Page />);
  expect(within(panel()).getByText("Showing 4 of 4")).toBeInTheDocument();
  expect(within(panel()).queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  await pick(user, "Category", /^Laser/);
  expect(within(panel()).getByText("Showing 1 of 4")).toBeInTheDocument();
  await user.click(within(panel()).getByRole("button", { name: "Clear filters" }));
  expect(window.location.search).toBe("?show=all");
});

it("offers Group by in All tools only, resting on Category", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<Page />);
  expect(within(panel()).getByRole("button", { name: "Group by: Category" })).toBeInTheDocument();
  await pick(user, "Group by", /^None/);
  expect(window.location.search).toBe("?show=all&group=none");
  unmount();

  window.history.replaceState(null, "", "/");
  render(<Page />);
  expect(within(panel()).queryByRole("button", { name: /^Group by/ })).not.toBeInTheDocument();
});

it("sorts, calling the default 'Best match' while searching", async () => {
  const user = userEvent.setup();
  const { unmount } = render(<Page />);
  await pick(user, "Sort", /Name Z–A/);
  expect(window.location.search).toBe("?show=all&sort=name-desc");
  unmount();
  window.history.replaceState(null, "", "/?q=resin");
  render(<Page />);
  expect(within(panel()).getByRole("button", { name: "Sort: Best match" })).toBeInTheDocument();
});

it("switches grid and table — a segmented control — and offers Columns for the table", async () => {
  const user = userEvent.setup();
  render(<Page />);
  const group = within(panel()).getByRole("group", { name: "View" });
  const [grid, table] = within(group).getAllByRole("button");
  expect(grid).toHaveAttribute("aria-pressed", "true");
  expect(within(panel()).queryByRole("button", { name: "Columns" })).not.toBeInTheDocument();
  await user.click(table);
  expect(window.location.search).toBe("?show=all&view=table");
  expect(table).toHaveAttribute("aria-pressed", "true");

  const firstTable = await screen.findByRole("table", { name: "Tools: 3D Printing" });
  expect(within(firstTable).queryByRole("columnheader", { name: /Official name/ })).not.toBeInTheDocument();
  await user.click(within(panel()).getByRole("button", { name: "Columns" }));
  await user.click(await screen.findByRole("menuitemcheckbox", { name: "Official name" }));
  await user.keyboard("{Escape}");
  expect(within(firstTable).getByRole("columnheader", { name: /Official name/ })).toBeInTheDocument();
});
