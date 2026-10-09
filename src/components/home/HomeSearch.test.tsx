import { useState } from "react";
import { render, screen, userEvent, within } from "../../../test/utils/render";
import { mockCatalog } from "../../../test/fixtures/catalog";
import { useChatLauncher } from "../ChatLauncherContext";
import { categoryEntries } from "../palette/palette-search";
import { HomeSearch } from "./HomeSearch";

/**
 * The home page's search (student home spec 2026-10-07 §6, amendment "One
 * page: the list at rest"): the matching tools are the page, so the box's own
 * list holds the matching categories and "Ask MakerLAB AI" last; Enter opens
 * the first result and never sends a question by accident.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const categories = categoryEntries(mockCatalog);

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return <output data-testid="chat">{isOpen ? `open|${pendingSeed?.text ?? ""}` : "closed"}</output>;
}

/** The box with its text held as the page holds it, and a stand-in for the page's first result. */
function Harness({ first, onCategory }: { first: (query: string) => { name: string; slug: string } | null; onCategory: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <>
      <HomeSearch
        value={value}
        onChange={setValue}
        categories={categories}
        firstResult={value.trim() ? first(value.trim()) : null}
        onCategory={(name) => {
          setValue("");
          onCategory(name);
        }}
        toolCount={4}
      />
      <output data-testid="query">{value}</output>
    </>
  );
}

/** The page's results for a few queries: "speedy" finds the Trotec, "woodworking" nothing by name. */
const FIRST: Record<string, { name: string; slug: string }> = {
  speedy: { name: "Trotec Speedy 400", slug: "trotec-speedy-400" },
  form: { name: "Form 4", slug: "form-4" },
};

function setup() {
  const user = userEvent.setup();
  const onCategory = vi.fn();
  render(
    <>
      <Harness first={(query) => FIRST[query] ?? null} onCategory={onCategory} />
      <ChatProbe />
    </>
  );
  const input = screen.getByRole("combobox", { name: "Search tools, or ask MakerLAB AI a question" });
  return { user, input, onCategory };
}

beforeEach(() => router.push.mockReset());

it("is one search landmark with a steady label, and lists nothing until something is typed", () => {
  const { input } = setup();
  expect(screen.getByRole("search", { name: "Search tools and ask MakerLAB AI" })).toContainElement(input);
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  // The rotating line starts on the live count.
  expect(screen.getByText("Search 4 tools")).toBeInTheDocument();
});

it("lists the matching categories, then Ask MakerLAB AI last — no tools, which are the page", async () => {
  const { user, input } = setup();
  await user.type(input, "resin");
  const names = screen.getAllByRole("option").map((option) => option.textContent);
  expect(names[0]).toMatch(/^3D Printing/);
  expect(names[names.length - 1]).toMatch(/^Ask MakerLAB AI: “resin”/);
  expect(screen.getByRole("group", { name: "Categories" })).toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Tools" })).not.toBeInTheDocument();
  expect(names.some((name) => /Form 4/.test(name ?? ""))).toBe(false);
});

it("selects nothing as you type, and says what Enter will open", async () => {
  const { user, input } = setup();
  await user.type(input, "speedy");
  for (const option of screen.getAllByRole("option")) expect(option).toHaveAttribute("aria-selected", "false");
  expect(screen.getByText("Enter opens Trotec Speedy 400")).toBeInTheDocument();
});

it("opens the page's first result on Enter, keeping the text for Back", async () => {
  const { user, input } = setup();
  await user.type(input, "speedy{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
  expect(input).toHaveValue("speedy");
});

it("opens the first category on Enter when no tool matches", async () => {
  const { user, input, onCategory } = setup();
  await user.type(input, "woodworking");
  expect(screen.getByText("Enter opens Woodworking")).toBeInTheDocument();
  await user.keyboard("{Enter}");
  expect(onCategory).toHaveBeenCalledWith("Woodworking");
  expect(router.push).not.toHaveBeenCalled();
});

it("filters the list to a category chosen in the list", async () => {
  const { user, input, onCategory } = setup();
  await user.type(input, "wood");
  await user.click(screen.getByRole("option", { name: /Woodworking/ }));
  expect(onCategory).toHaveBeenCalledWith("Woodworking");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
});

it("never asks on Enter when nothing matches; asking takes a deliberate choice", async () => {
  const { user, input, onCategory } = setup();
  await user.type(input, "how do I load filament{Enter}");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
  expect(router.push).not.toHaveBeenCalled();
  expect(onCategory).not.toHaveBeenCalled();
  expect(screen.getByText("No tool or category matches “how do I load filament”.")).toBeInTheDocument();
  // Nothing is highlighted, so nothing would be sent.
  expect(screen.getByRole("option", { name: /Ask MakerLAB AI/ })).toHaveAttribute("aria-selected", "false");

  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: /Ask MakerLAB AI/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(screen.getByTestId("chat")).toHaveTextContent("open|how do I load filament");
  // The box empties once the question is on its way.
  expect(input).toHaveValue("");
});

it("moves through the categories with the arrow keys, and Enter takes the one chosen", async () => {
  const { user, input, onCategory } = setup();
  await user.type(input, "form");
  // "form" matches no category: the first row down is Ask.
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: /Ask MakerLAB AI/ })).toHaveAttribute("aria-selected", "true");
  await user.clear(input);
  await user.type(input, "printing");
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: /3D Printing/ })).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");
  expect(onCategory).toHaveBeenCalledWith("3D Printing");
  expect(screen.getByTestId("chat")).toHaveTextContent("closed");
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
  // Closed, Enter still opens the first result.
  await user.keyboard("{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/form-4");
  await user.keyboard("{Escape}");
  expect(input).toHaveValue("");
});

it("empties the box with its × and keeps the focus in it", async () => {
  const { user, input } = setup();
  expect(screen.queryByRole("button", { name: "Clear the search" })).not.toBeInTheDocument();
  await user.type(input, "form");
  await user.click(screen.getByRole("button", { name: "Clear the search" }));
  expect(screen.getByTestId("query")).toHaveTextContent("");
  expect(input).toHaveFocus();
});
