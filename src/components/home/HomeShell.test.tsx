import { render, screen, userEvent, within } from "../../../test/utils/render";
import { mockCatalog } from "../../../test/fixtures/catalog";
import type { MakerLabTool } from "../catalog-types";
import { useChatLauncher } from "../ChatLauncherContext";
import { HomeShell } from "./HomeShell";

/**
 * The home page is the tool list (student home spec 2026-10-07, amendment
 * "One page: the list at rest"): "MakerLAB AI" and the one search box, then
 * every tool grouped by category; typing swaps the groups for the matching
 * tools on the same page, and emptying the box brings them back.
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
});

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return <output data-testid="chat">{isOpen ? `open|${pendingSeed?.text ?? ""}` : "closed"}</output>;
}

function setup(tools: MakerLabTool[] = mockCatalog, categoryOrder: string[] = ["Laser", "3D Printing", "Woodworking"]) {
  const user = userEvent.setup();
  render(
    <>
      <HomeShell tools={tools} categoryOrder={categoryOrder} />
      <ChatProbe />
    </>
  );
  const input = screen.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
  return { user, input };
}

const sections = () => Array.from(document.querySelectorAll('[data-slot="gallery-section"] h2 > span:first-child')).map((el) => el.textContent);
const cards = () =>
  Array.from(document.querySelectorAll('[data-slot="tool-card"]')).map((card) => within(card as HTMLElement).getByRole("heading").textContent);

it("is headed MakerLAB AI, with one search box, and the logo drawn once on the page", () => {
  setup();
  expect(screen.getByRole("heading", { level: 1, name: "MakerLAB AI" })).toBeInTheDocument();
  const lockup = document.querySelector('[data-slot="landing-lockup"]')!;
  expect(lockup.querySelector(".brand-wordmark")).toHaveAttribute("aria-hidden", "true");
  expect(lockup.querySelector(".brand-ai")).toHaveTextContent("AI");
  expect(document.querySelectorAll('[data-slot="landing-lockup"]')).toHaveLength(1);
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  // Two landmarks: the search, and the list's filters under it.
  expect(screen.getAllByRole("search").map((landmark) => landmark.getAttribute("aria-label"))).toEqual([
    "Search tools and ask MakerLAB AI",
    "Filter the tools",
  ]);
});

it("rests on every tool grouped by category in the lab's order — no tiles, no way to a second list", () => {
  const { container } = render(<HomeShell tools={mockCatalog} categoryOrder={["Laser", "3D Printing", "Woodworking"]} />);
  expect(sections()).toEqual(["Laser", "3D Printing", "Woodworking"]);
  expect(cards()).toEqual(["Trotec Speedy 400", "Prusa MK4", "Form 4", "Bandsaw"]);
  expect(document.querySelector('[data-slot="category-tile"]')).toBeNull();
  expect(container.textContent).not.toMatch(/see all/i);
  expect(container.textContent).not.toMatch(/what do you want to make/i);
});

it("swaps the groups for the matching tools as you type, and brings them back when the box is emptied", async () => {
  const { user, input } = setup();
  await user.type(input, "prusa");
  expect(window.location.search).toBe("?q=prusa");
  expect(sections()).toEqual([]);
  expect(screen.getByRole("region", { name: /Results for “prusa”/ })).toBeInTheDocument();
  expect(cards()).toEqual(["Prusa MK4"]);

  await user.click(screen.getByRole("button", { name: "Clear the search" }));
  expect(window.location.search).toBe("");
  expect(sections()).toEqual(["Laser", "3D Printing", "Woodworking"]);
});

it("keeps the search box and the bar where they are while results replace the groups", async () => {
  const { user, input } = setup();
  const frame = input.closest('[data-slot="search-frame"]');
  const filters = screen.getByRole("search", { name: "Filter the tools" });
  await user.type(input, "form");
  // The same elements, not new ones: nothing above the list is redrawn.
  expect(input.closest('[data-slot="search-frame"]')).toBe(frame);
  expect(screen.getByRole("search", { name: "Filter the tools" })).toBe(filters);
});

it("opens the first result on Enter", async () => {
  const { user, input } = setup();
  await user.type(input, "speedy{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
});

it("ranks a hidden-by-default category's tools after the list's own", async () => {
  const tools = mockCatalog.map((tool) =>
    tool.slug === "bandsaw" ? { ...tool, name: "Saw blade", category: "Shop Infrastructure & Supplies", galleryHidden: true } : tool.slug === "trotec-speedy-400" ? { ...tool, name: "Laser saw" } : tool
  );
  const { user, input } = setup(tools);
  await user.type(input, "saw");
  // "Saw blade" starts with the word, but supplies come after the lab's machines.
  expect(cards()).toEqual(["Laser saw", "Saw blade"]);
  await user.keyboard("{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
});

it("filters the list to a category chosen in the box's list, and empties the box", async () => {
  const { user, input } = setup();
  await user.type(input, "wood");
  await user.click(screen.getByRole("option", { name: /Woodworking/ }));
  expect(window.location.search).toBe("?category=Woodworking");
  expect(input).toHaveValue("");
  expect(sections()).toEqual(["Woodworking"]);
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
