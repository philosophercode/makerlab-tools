import { render, screen, userEvent, waitFor, within } from "../../../test/utils/render";
import { useChatLauncher } from "../ChatLauncherContext";
import type { ToolIndexEntry } from "../../lib/data/tool-index";
import { CommandPalette } from "./CommandPalette";
import { paletteScore } from "./palette-match";

/**
 * The admin ⌘K palette (UI system spec §7.5): opens on ⌘K / Ctrl-K, lists only
 * the surfaces the viewer's role opens, finds tools by display name, official
 * name or slug, runs the two admin actions, says when the tool list could not
 * be read, and offers the assistant only when phase 5 hands it `onAsk`.
 */

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/admin" }));

const TOOLS: ToolIndexEntry[] = [
  { id: "t1", slug: "form-4", name: "Form 4", officialName: "Formlabs Form 4", published: true },
  { id: "t2", slug: "trotec-speedy-400", name: "Laser cutter", officialName: "Trotec Speedy 400", published: true },
  { id: "t3", slug: "glowforge-pro", name: "Glowforge", officialName: null, published: false },
];

function ChatProbe() {
  const { isOpen, pendingSeed } = useChatLauncher();
  return <output data-testid="chat">{isOpen ? `open|${pendingSeed?.text ?? ""}` : "closed"}</output>;
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");
  return screen.findByRole("dialog", { name: "Command palette" });
}

beforeEach(() => router.push.mockReset());

it("opens on Ctrl-K and on its button, and closes on Escape", async () => {
  const user = userEvent.setup();
  render(<CommandPalette role="admin" tools={TOOLS} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await openPalette(user);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: "Open the command palette" }));
  expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
});

it("lists a SuperMaker's surfaces and not People", async () => {
  const user = userEvent.setup();
  render(<CommandPalette role="admin" tools={TOOLS} />);
  const dialog = await openPalette(user);
  expect(within(dialog).getByRole("option", { name: /Maintenance/ })).toBeInTheDocument();
  expect(within(dialog).queryByRole("option", { name: /^People/ })).not.toBeInTheDocument();
});

it("lists People for a super admin, and jumps there", async () => {
  const user = userEvent.setup();
  render(<CommandPalette role="super_admin" tools={TOOLS} />);
  const dialog = await openPalette(user);
  await user.click(within(dialog).getByRole("option", { name: /^People/ }));
  expect(router.push).toHaveBeenCalledWith("/admin/users");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("finds a tool by its official name and opens its page", async () => {
  const user = userEvent.setup();
  render(<CommandPalette role="admin" tools={TOOLS} />);
  const dialog = await openPalette(user);
  await user.type(within(dialog).getByRole("combobox"), "speedy");
  const options = within(dialog).getAllByRole("option");
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent("Laser cutter");
  await user.keyboard("{Enter}");
  expect(router.push).toHaveBeenCalledWith("/tools/trotec-speedy-400");
});

it("marks a draft, and says when nothing matches", async () => {
  const user = userEvent.setup();
  render(<CommandPalette role="admin" tools={TOOLS} />);
  const dialog = await openPalette(user);
  expect(within(dialog).getByRole("option", { name: /Glowforge/ })).toHaveTextContent("Draft");
  await user.type(within(dialog).getByRole("combobox"), "zzzz");
  expect(within(dialog).getByText("Nothing matches “zzzz”.")).toBeInTheDocument();
});

it("adds equipment through the assistant with the profile menu's seed", async () => {
  const user = userEvent.setup();
  render(
    <>
      <CommandPalette role="admin" tools={TOOLS} />
      <ChatProbe />
    </>
  );
  const dialog = await openPalette(user);
  await user.click(within(dialog).getByRole("option", { name: "Add equipment" }));
  expect(screen.getByTestId("chat")).toHaveTextContent("open|I'd like to add new equipment to the inventory.");
});

it("refreshes the catalog and says so in place", async () => {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true } as unknown as Response);
  render(<CommandPalette role="admin" tools={TOOLS} />);
  const dialog = await openPalette(user);
  await user.click(within(dialog).getByRole("option", { name: /Refresh the catalog/ }));
  expect(fetchSpy).toHaveBeenCalledWith("/api/admin/revalidate", expect.objectContaining({ method: "POST" }));
  expect(await within(dialog).findByText("Catalog refreshed")).toBeInTheDocument();
  fetchSpy.mockRestore();
});

it("says the tool list could not be read, rather than showing none", async () => {
  const user = userEvent.setup();
  render(<CommandPalette role="admin" tools={null} />);
  const dialog = await openPalette(user);
  expect(within(dialog).getByText("The tool list could not be read.")).toBeInTheDocument();
});

it("offers the assistant only when it is given onAsk (phase 5's hook)", async () => {
  const user = userEvent.setup();
  const onAsk = vi.fn();
  const { unmount } = render(<CommandPalette role="admin" tools={TOOLS} />);
  let dialog = await openPalette(user);
  await user.type(within(dialog).getByRole("combobox"), "how do I");
  expect(within(dialog).queryByRole("option", { name: /Ask the assistant/ })).not.toBeInTheDocument();
  unmount();

  render(<CommandPalette role="admin" tools={TOOLS} onAsk={onAsk} />);
  dialog = await openPalette(user);
  await user.type(within(dialog).getByRole("combobox"), "how do I");
  await user.click(within(dialog).getByRole("option", { name: /Ask the assistant: “how do I”/ }));
  expect(onAsk).toHaveBeenCalledWith("how do I");
});

it("focuses the page's filter search on /, but not while typing", async () => {
  const user = userEvent.setup();
  render(
    <>
      <CommandPalette role="admin" tools={TOOLS} />
      <div role="search">
        <input type="search" aria-label="Filter" />
      </div>
      <input aria-label="Other" />
    </>
  );
  await user.keyboard("/");
  expect(screen.getByRole("searchbox", { name: "Filter" })).toHaveFocus();

  await user.click(screen.getByRole("textbox", { name: "Other" }));
  await user.keyboard("/");
  expect(screen.getByRole("textbox", { name: "Other" })).toHaveValue("/");
});

describe("paletteScore", () => {
  it("needs every word, in any keyword", () => {
    expect(paletteScore("form 4", ["Form 4", "Formlabs Form 4"])).toBeGreaterThan(0);
    expect(paletteScore("speedy trotec", ["Laser cutter", "Trotec Speedy 400"])).toBeGreaterThan(0);
    expect(paletteScore("speedy prusa", ["Laser cutter", "Trotec Speedy 400"])).toBe(0);
  });

  it("is not fuzzy: letters in order are not a match", () => {
    expect(paletteScore("fm4", ["Form 4"])).toBe(0);
  });

  it("ranks exact over prefix over contains, and ignores case and accents", () => {
    const exact = paletteScore("inventory", ["Inventory"]);
    const prefix = paletteScore("inven", ["Inventory"]);
    const contains = paletteScore("ventory", ["Inventory"]);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(contains);
    expect(paletteScore("perez", ["Pérez lathe"])).toBeGreaterThan(0);
  });

  it("matches everything on an empty query", () => {
    expect(paletteScore("  ", ["anything"])).toBe(1);
  });
});
