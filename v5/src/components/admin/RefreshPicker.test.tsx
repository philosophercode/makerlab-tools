import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { QueueRefreshAction } from "../../app/admin/refresh/action-result";
import { RefreshPicker } from "./RefreshPicker";
import { isStale, matchesPicker, NO_PICKER_FILTERS, pickerCategories, type PickerTool } from "./refresh-picker-filters";

/**
 * **Refresh research…** on `/admin/refresh` (amendment 2026-09-25 "Admin
 * polish"): presets, a category and a name narrow the tools; the start goes
 * through the inventory's own action with its limits.
 */

const NOW = "2026-09-25T12:00:00.000Z";
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString();

function tool(overrides: Partial<PickerTool> & Pick<PickerTool, "id" | "name">): PickerTool {
  return {
    officialName: null,
    categoryName: "Laser",
    noManual: false,
    neverReviewed: false,
    lastRefreshedAt: daysAgo(10),
    refreshOpen: false,
    ...overrides,
  };
}

const TOOLS: PickerTool[] = [
  tool({ id: "form", name: "Form 4", categoryName: "Resin", neverReviewed: true, noManual: true, lastRefreshedAt: null }),
  tool({ id: "trotec", name: "Trotec Speedy 400", neverReviewed: true, lastRefreshedAt: daysAgo(120) }),
  tool({ id: "epilog", name: "Epilog Fusion", officialName: "Epilog Fusion Pro 32" }),
  tool({ id: "busy", name: "Busy Laser", neverReviewed: true, refreshOpen: true }),
];

describe("the picker's filters", () => {
  const now = new Date(NOW);

  it("counts a tool never refreshed, or refreshed 90 or more days ago, as not refreshed in 90 days", () => {
    expect(isStale(TOOLS[0], now)).toBe(true);
    expect(isStale(TOOLS[1], now)).toBe(true);
    expect(isStale(TOOLS[2], now)).toBe(false);
  });

  it("combines presets, a category and a name", () => {
    const ids = (filters: Parameters<typeof matchesPicker>[1]) => TOOLS.filter((t) => matchesPicker(t, filters, now)).map((t) => t.id);
    expect(ids(NO_PICKER_FILTERS)).toEqual(["form", "trotec", "epilog", "busy"]);
    expect(ids({ ...NO_PICKER_FILTERS, presets: ["neverReviewed"] })).toEqual(["form", "trotec", "busy"]);
    expect(ids({ ...NO_PICKER_FILTERS, presets: ["neverReviewed", "noManual"] })).toEqual(["form"]);
    expect(ids({ ...NO_PICKER_FILTERS, presets: ["stale"], category: "Laser" })).toEqual(["trotec"]);
    // The official name is searched beside the display name.
    expect(ids({ ...NO_PICKER_FILTERS, query: "pro 32" })).toEqual(["epilog"]);
  });

  it("offers each category once, sorted", () => {
    expect(pickerCategories(TOOLS)).toEqual(["Laser", "Resin"]);
  });
});

describe("RefreshPicker", () => {
  async function openPicker(action = vi.fn<QueueRefreshAction>(async () => ({ ok: true, queued: 2, skipped: 0, missing: 0 }))) {
    const user = userEvent.setup();
    render(<RefreshPicker tools={TOOLS} action={action} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Refresh research…" }));
    const dialog = screen.getByRole("dialog", { name: "Refresh research" });
    return { user, action, dialog };
  }

  it("opens a dialog listing every tool, with a tool whose refresh is open not selectable", async () => {
    const { dialog } = await openPicker();
    const table = within(dialog).getByRole("table", { name: "Tools that can be researched again" });
    expect(within(table).getAllByRole("rowheader").map((cell) => cell.textContent)).toEqual([
      "Form 4",
      "Trotec Speedy 400",
      "Epilog Fusion",
      "Busy LaserRefresh open",
    ]);
    expect(within(table).getByRole("checkbox", { name: /Busy Laser/ })).toBeDisabled();
  });

  it("narrows by a preset, selects the ones it may, and queues them through the action", async () => {
    const { user, action, dialog } = await openPicker();
    const neverReviewed = within(dialog).getByRole("button", { name: "Never reviewed" });
    await user.click(neverReviewed);
    expect(neverReviewed).toHaveAttribute("aria-pressed", "true");
    await user.click(within(dialog).getByRole("button", { name: "Select the first 25" }));
    expect(within(dialog).getByText("3 shown · 2 selected")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Refresh research (2)" }));
    expect(action).toHaveBeenCalledWith({ toolIds: ["form", "trotec"], includeDescription: false, note: null });
    expect(await within(dialog).findByText("Refreshing 2 tools — results appear on the Refresh page.")).toBeInTheDocument();
  });

  it("sends description rewrites only when asked", async () => {
    const { user, action, dialog } = await openPicker();
    await user.click(within(dialog).getByRole("checkbox", { name: "Select Epilog Fusion" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "Also propose description rewrites" }));
    await user.click(within(dialog).getByRole("button", { name: "Refresh research (1)" }));
    expect(action).toHaveBeenCalledWith({ toolIds: ["epilog"], includeDescription: true, note: null });
  });

  it("says the day's limit in the server's words", async () => {
    const { user, dialog } = await openPicker(vi.fn<QueueRefreshAction>(async () => ({ ok: false, error: "daily_limit", remaining: 1 })));
    await user.click(within(dialog).getByRole("checkbox", { name: "Select Form 4" }));
    await user.click(within(dialog).getByRole("button", { name: "Refresh research (1)" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("That would pass today's research limit. 1 left today.");
  });

  it("will not start with nothing selected", async () => {
    const { dialog } = await openPicker();
    expect(within(dialog).getByRole("button", { name: "Refresh research" })).toBeDisabled();
  });

  it("names the filters that emptied the list, with Clear", async () => {
    const { user, dialog } = await openPicker();
    await user.type(within(dialog).getByLabelText("Name"), "glowforge");
    expect(within(dialog).getByText("No tools match “glowforge”.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Clear filters" }));
    expect(within(dialog).getByText("4 shown · 0 selected")).toBeInTheDocument();
  });

  it("will not send more than one press may", async () => {
    const many = Array.from({ length: 30 }, (_, n) => tool({ id: `t${n}`, name: `Tool ${String(n).padStart(2, "0")}` }));
    const user = userEvent.setup();
    render(<RefreshPicker tools={many} action={vi.fn()} now={NOW} />);
    await user.click(screen.getByRole("button", { name: "Refresh research…" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("checkbox", { name: "Select all shown" }));
    expect(within(dialog).getByRole("button", { name: "Refresh research (30)" })).toBeDisabled();
    expect(within(dialog).getByText("Refresh at most 25 tools at a time.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Select the first 25" }));
    expect(within(dialog).getByRole("button", { name: "Refresh research (25)" })).toBeEnabled();
  });
});
