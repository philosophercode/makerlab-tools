import { render, screen, userEvent, within } from "../../../test/utils/render";
import { mockCatalog } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";
import { useChatLauncher } from "../ChatLauncherContext";
import { HomeShell } from "./HomeShell";
import { forgetFiltersOpen } from "./use-filters-open";

/**
 * The home page (student home spec 2026-10-07, amendment "One page: the list
 * at rest", revised): "MakerLAB AI", the one search box, a quiet row —
 * Categories | All tools and Filters — then the content. Typing swaps the
 * content for the matching tools on the same page, in either view.
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

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  router.push.mockReset();
  forgetFiltersOpen();
});

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return <output data-testid="chat">{isOpen ? `open|${pendingSeed?.text ?? ""}` : "closed"}</output>;
}

function setup(tools: MakerLabTool[] = mockCatalog, categoryOrder: string[] = ["Laser", "3D Printing", "Woodworking"]) {
  const user = userEvent.setup();
  const view = render(
    <>
      <HomeShell tools={tools} categoryOrder={categoryOrder} />
      <ChatProbe />
    </>
  );
  const input = screen.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
  return { user, input, ...view };
}

const tiles = () =>
  Array.from(document.querySelectorAll('[data-slot="category-tile"]')).map((tile) => within(tile as HTMLElement).getByRole("heading").textContent);
const sections = () => Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2 > span:first-child')).map((el) => el.textContent);
const cards = () =>
  Array.from(document.querySelectorAll('[data-slot="tool-card"]')).map((card) => within(card as HTMLElement).getByRole("heading").textContent);
const filtersButton = () => screen.getByRole("button", { name: /^Filters/ });
const panel = () => document.querySelector('[data-slot="filters-panel"]') as HTMLElement;

it("is headed MakerLAB AI, with one search box, and the logo drawn once on the page", () => {
  setup();
  expect(screen.getByRole("heading", { level: 1, name: "MakerLAB AI" })).toBeInTheDocument();
  const lockup = document.querySelector('[data-slot="landing-lockup"]')!;
  expect(lockup.querySelector(".brand-wordmark")).toHaveAttribute("aria-hidden", "true");
  expect(lockup.querySelector(".brand-ai")).toHaveTextContent("AI");
  expect(document.querySelectorAll('[data-slot="landing-lockup"]')).toHaveLength(1);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
});

it("rests on the search, a quiet row and the category tiles — no chips, no filters on the page", () => {
  setup();
  const browse = screen.getByRole("group", { name: "Browse" });
  expect(within(browse).getByRole("button", { name: "Categories" })).toHaveAttribute("aria-pressed", "true");
  expect(within(browse).getByRole("button", { name: "All tools" })).toHaveAttribute("aria-pressed", "false");
  expect(filtersButton()).toHaveAttribute("aria-expanded", "false");
  expect(panel()).toHaveAttribute("hidden");
  // The only landmark showing is the search's: the filters are in the closed panel.
  expect(screen.getAllByRole("search").map((landmark) => landmark.getAttribute("aria-label"))).toEqual(["Search tools and ask MakerLAB AI"]);
  expect(document.querySelector('[data-slot="category-chips"]')).toBeNull();
  expect(tiles()).toEqual(["Laser", "3D Printing", "Woodworking"]);
  expect(cards()).toEqual([]);
});

it("switches to All tools — every tool grouped by category — and back, a view in the URL", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "All tools" }));
  expect(window.location.search).toBe("?show=all");
  expect(sections()).toEqual(["Laser", "3D Printing", "Woodworking"]);
  expect(cards()).toEqual(["Trotec Speedy 400", "Prusa MK4", "Form 4", "Bandsaw"]);
  await user.click(screen.getByRole("button", { name: "Categories" }));
  expect(window.location.search).toBe("");
  expect(tiles()).toHaveLength(3);
});

it("starts a view afresh: switching drops an opened category", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("link", { name: /3D Printing/ }));
  expect(screen.getByRole("heading", { level: 2, name: "3D Printing" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "All tools" }));
  expect(window.location.search).toBe("?show=all");
  expect(sections()).toHaveLength(3);
});

it("opens and closes the Filters panel from its button, and remembers that for the visit", async () => {
  const { user, unmount } = setup();
  await user.click(filtersButton());
  expect(filtersButton()).toHaveAttribute("aria-expanded", "true");
  expect(filtersButton()).toHaveAttribute("aria-controls", panel().id);
  expect(panel()).not.toHaveAttribute("hidden");
  expect(screen.getByRole("search", { name: "Filter the tools" })).toBeInTheDocument();
  unmount();

  // Back from a tool page: still open.
  setup();
  expect(filtersButton()).toHaveAttribute("aria-expanded", "true");
  await userEvent.setup().click(filtersButton());
  expect(panel()).toHaveAttribute("hidden");
});

it("opens the panel when a link arrives with a filter set, and counts them on the button", () => {
  window.history.replaceState(null, "", "/?show=all&status=Available&location=MakerLab");
  setup();
  expect(filtersButton()).toHaveAccessibleName("Filters, 2 set");
  expect(filtersButton()).toHaveAttribute("aria-expanded", "true");
  expect(within(screen.getByRole("search", { name: "Filter the tools" })).getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
});

it("does not count an opened category as a filter, nor open the panel for it", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("link", { name: /Laser/ }));
  expect(window.location.search).toBe("?category=Laser");
  expect(filtersButton()).toHaveAccessibleName("Filters");
  expect(panel()).toHaveAttribute("hidden");
});

it("counts the category as a filter in All tools", () => {
  window.history.replaceState(null, "", "/?show=all&category=Laser");
  setup();
  expect(filtersButton()).toHaveAccessibleName("Filters, 1 set");
});

it("swaps the view for the matching tools as you type, and brings it back when the box is emptied", async () => {
  const { user, input } = setup();
  await user.type(input, "prusa");
  expect(window.location.search).toBe("?q=prusa");
  expect(tiles()).toEqual([]);
  expect(screen.getByRole("region", { name: /Results for “prusa”/ })).toBeInTheDocument();
  expect(cards()).toEqual(["Prusa MK4"]);

  await user.click(screen.getByRole("button", { name: "Clear the search" }));
  expect(window.location.search).toBe("");
  expect(tiles()).toEqual(["Laser", "3D Printing", "Woodworking"]);
});

it("searches the same way from All tools", async () => {
  window.history.replaceState(null, "", "/?show=all");
  const { user, input } = setup();
  await user.type(input, "speedy");
  expect(sections()).toEqual([]);
  expect(cards()).toEqual(["Trotec Speedy 400"]);
  await user.keyboard("{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
});

it("keeps the search box and the row where they are while results replace the view", async () => {
  const { user, input } = setup();
  const frame = input.closest('[data-slot="search-frame"]');
  const row = document.querySelector('[data-slot="home-controls"]');
  await user.type(input, "form");
  expect(input.closest('[data-slot="search-frame"]')).toBe(frame);
  expect(document.querySelector('[data-slot="home-controls"]')).toBe(row);
});

it("opens the first result on Enter", async () => {
  const { user, input } = setup();
  await user.type(input, "speedy{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
});

it("ranks a hidden-by-default category's tools after the list's own", async () => {
  const tools = mockCatalog.map((tool) =>
    tool.slug === "bandsaw"
      ? { ...tool, name: "Saw blade", category: "Shop Infrastructure & Supplies", galleryHidden: true }
      : tool.slug === "trotec-speedy-400"
        ? { ...tool, name: "Laser saw" }
        : tool
  );
  const { user, input } = setup(tools);
  await user.type(input, "saw");
  // "Saw blade" starts with the word, but supplies come after the lab's machines.
  expect(cards()).toEqual(["Laser saw", "Saw blade"]);
});

it("opens a category chosen in the box's list, and empties the box", async () => {
  const { user, input } = setup();
  await user.type(input, "wood");
  await user.click(screen.getByRole("option", { name: /Woodworking/ }));
  expect(window.location.search).toBe("?category=Woodworking");
  expect(input).toHaveValue("");
  expect(screen.getByRole("heading", { level: 2, name: "Woodworking" })).toBeInTheDocument();
  expect(cards()).toEqual(["Bandsaw"]);
});

it("never asks on Enter when nothing matches, and offers Ask MakerLAB AI in place of the results", async () => {
  const { user, input } = setup();
  await user.type(input, "how do I load filament{Enter}");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
  expect(router.push).not.toHaveBeenCalled();
  const empty = screen.getByRole("region", { name: "Tool gallery" });
  expect(within(empty).getByText('No tools match "how do I load filament".')).toBeInTheDocument();
  await user.click(within(empty).getByRole("button", { name: /Ask MakerLAB AI: “how do I load filament”/ }));
  expect(screen.getByTestId("chat")).toHaveTextContent("open|how do I load filament");
});

it("restores a search from the URL (Back from a tool page)", () => {
  window.history.replaceState(null, "", "/?q=form");
  setup();
  expect(screen.getByRole("combobox")).toHaveValue("form");
  expect(cards()).toEqual(["Form 4"]);
});
