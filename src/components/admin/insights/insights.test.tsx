import { render, screen, userEvent, within } from "../../../../test/utils/render";
import type { GapRow } from "../../../lib/usage/queries";
import { BusiestHeatmap, heatShade } from "./BusiestHeatmap";
import { answeredPercent } from "./InsightsSummary";
import { insightsHref, parseInsightsParams } from "./insights-params";
import { UnansweredQueue } from "./UnansweredQueue";

const GAP: GapRow = {
  id: "44444444-4444-4444-8444-444444444444",
  question: "<b>Can</b> the Trotec cut glass?",
  kind: "no_manual_passage",
  toolId: "22222222-2222-4222-8222-222222222222",
  toolName: "Trotec Speedy 400",
  toolSlug: "trotec-speedy-400",
  occurrences: 3,
  firstSeen: "2026-09-20T20:00:00.000Z",
  lastSeen: "2026-09-27T21:00:00.000Z",
};

describe("UnansweredQueue", () => {
  it("shows the question as text, never HTML, with its tool, kind and count", () => {
    render(<UnansweredQueue gaps={[GAP]} fileCorrection={vi.fn()} dismiss={vi.fn()} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("<b>Can</b> the Trotec cut glass?")).toBeInTheDocument();
    expect(row.querySelector("b")).toBeNull();
    expect(within(row).getByText("Manual has no answer")).toBeInTheDocument();
    expect(within(row).getByText("asked 3 times")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "Add a manual to Trotec Speedy 400" })).toHaveAttribute("href", "/tools/trotec-speedy-400");
  });

  it("files a gap through its action and says so", async () => {
    const fileCorrection = vi.fn(async () => ({ ok: true as const }));
    render(<UnansweredQueue gaps={[GAP]} fileCorrection={fileCorrection} dismiss={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /File “.*” as a correction/ }));
    expect(fileCorrection).toHaveBeenCalledWith({ gapId: GAP.id });
    expect(await screen.findByText("Filed as a correction. It is on the Corrections queue.")).toBeInTheDocument();
  });

  it("keeps the row and shows the refusal when the action is refused", async () => {
    const dismiss = vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const }));
    render(<UnansweredQueue gaps={[GAP]} fileCorrection={vi.fn()} dismiss={dismiss} />);
    await userEvent.click(screen.getByRole("button", { name: /Dismiss/ }));
    expect(await screen.findByRole("button", { name: /Dismiss/ })).toBeEnabled();
    expect(screen.queryByText(/Dismissed\. It comes back/)).toBeNull();
  });

  it("offers no manual link for a question about no particular tool, and says when the queue is empty", () => {
    const { unmount } = render(<UnansweredQueue gaps={[{ ...GAP, toolId: null, toolName: null, toolSlug: null }]} fileCorrection={vi.fn()} dismiss={vi.fn()} />);
    expect(screen.queryByRole("link", { name: /Add a manual/ })).toBeNull();
    unmount();
    render(<UnansweredQueue gaps={[]} fileCorrection={vi.fn()} dismiss={vi.fn()} />);
    expect(screen.getByText("No open unanswered questions.")).toBeInTheDocument();
  });
});

describe("BusiestHeatmap", () => {
  it("is a table a screen reader can read: days, hours and each cell's count", () => {
    const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    heatmap[2][14] = 6;
    render(<BusiestHeatmap heatmap={heatmap} timeZone="America/New_York" />);
    const table = screen.getByRole("table", { name: /by day of the week and hour/ });
    expect(within(table).getAllByRole("rowheader").map((th) => th.textContent)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(within(table).getByText("Tue 14:00 — 6")).toBeInTheDocument();
    expect(screen.getByText(/in lab time \(America\/New_York\)/)).toBeInTheDocument();
  });

  it("shades from the theme's ink, and leaves an empty cell unshaded", () => {
    expect(heatShade(0, 10)).toBeUndefined();
    expect(heatShade(10, 10)).toContain("var(--primary-ink)");
  });
});

describe("the page's small rules", () => {
  it("reads the period and the staff toggle from the URL, falling back to 30 days without staff", () => {
    expect(parseInsightsParams({})).toEqual({ days: 30, includeStaff: false });
    expect(parseInsightsParams({ days: "7", staff: "1" })).toEqual({ days: 7, includeStaff: true });
    expect(parseInsightsParams({ days: "365" })).toEqual({ days: 30, includeStaff: false });
    expect(insightsHref({ days: 90, includeStaff: true })).toBe("/admin/insights?days=90&staff=1");
    expect(insightsHref({ days: 30, includeStaff: false })).toBe("/admin/insights");
  });

  it("computes the answered rate only when there was a question", () => {
    expect(answeredPercent({ chatTurns: 0, gaps: 0 })).toBeNull();
    expect(answeredPercent({ chatTurns: 40, gaps: 4 })).toBe(90);
  });
});
