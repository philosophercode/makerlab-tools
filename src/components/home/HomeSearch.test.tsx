import { render, screen, userEvent, within } from "../../../test/utils/render";
import { mockCatalog } from "../../../test/fixtures/catalog";
import { useChatLauncher } from "../ChatLauncherContext";
import { HomeSearch } from "./HomeSearch";
import { toHomeTool } from "./home-tools";

/**
 * The home page's smart search (student home spec 2026-10-07 §6): tools
 * first, then categories, then "Ask MakerLAB AI" last; Enter opens the first
 * match and never sends a question by accident.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const tools = mockCatalog.map(toHomeTool);

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return <output data-testid="chat">{isOpen ? `open|${pendingSeed?.text ?? ""}` : "closed"}</output>;
}

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <HomeSearch tools={tools} toolCount={4} />
      <ChatProbe />
    </>
  );
  const input = screen.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
  return { user, input };
}

beforeEach(() => router.push.mockReset());

it("is one search landmark with a steady label, and lists nothing until something is typed", () => {
  const { input } = setup();
  expect(screen.getByRole("search", { name: "Search tools and ask MakerLAB AI" })).toContainElement(input);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  // The rotating line starts on the live count.
  expect(screen.getByText("Search 4 tools")).toBeInTheDocument();
});

it("lists tools, then categories, then Ask MakerLAB AI last", async () => {
  const { user, input } = setup();
  await user.type(input, "form");
  const options = screen.getAllByRole("option");
  expect(options[0]).toHaveTextContent("Form 4");
  expect(options[options.length - 1]).toHaveTextContent("Ask MakerLAB AI: “form”");

  await user.clear(input);
  await user.type(input, "resin");
  const names = screen.getAllByRole("option").map((option) => option.textContent);
  expect(names[0]).toMatch(/^3D Printing/);
  expect(names[names.length - 1]).toMatch(/^Ask MakerLAB AI: “resin”/);
  expect(screen.getByRole("group", { name: "Categories" })).toBeInTheDocument();
});

it("opens the first match on Enter", async () => {
  const { user, input } = setup();
  await user.type(input, "speedy");
  expect(screen.getByRole("option", { name: /Trotec Speedy 400/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
});

it("opens a category as the full list filtered to it", async () => {
  const { user, input } = setup();
  await user.type(input, "woodworking");
  await user.click(screen.getByRole("option", { name: /Woodworking/ }));
  expect(router.push).toHaveBeenCalledWith("/tools?category=Woodworking");
});

it("never asks on Enter when nothing matches; asking takes a deliberate choice", async () => {
  const { user, input } = setup();
  await user.type(input, "how do I load filament{Enter}");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
  expect(router.push).not.toHaveBeenCalled();
  expect(screen.getByText("No tool or category matches “how do I load filament”.")).toBeInTheDocument();
  // Nothing is highlighted, so nothing would be sent.
  expect(screen.getByRole("option", { name: /Ask MakerLAB AI/ })).toHaveAttribute("aria-selected", "false");

  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByTestId("chat")).toHaveTextContent("open|how do I load filament");
  // The box empties once the question is on its way.
  expect(input).toHaveValue("");
});

it("asks with a click on the Ask row, even when tools match", async () => {
  const { user, input } = setup();
  await user.type(input, "form");
  const ask = screen.getByRole("option", { name: /Ask MakerLAB AI/ });
  expect(within(ask).getByText(/can make mistakes/)).toBeInTheDocument();
  await user.click(ask);
  expect(screen.getByTestId("chat")).toHaveTextContent("open|form");
  expect(router.push).not.toHaveBeenCalled();
});

it("closes the list on Escape, and clears the text on a second Escape", async () => {
  const { user, input } = setup();
  await user.type(input, "form");
  expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(input).toHaveValue("");
});
