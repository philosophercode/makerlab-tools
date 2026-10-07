const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }), usePathname: () => "/admin/insights/value" }));

import { createTranslator } from "next-intl";
import enMessages from "../../../../../messages/en.json";
import { render, screen, userEvent, within } from "../../../../../test/utils/render";
import { defaultAssumptions } from "../../../../lib/usage/value/assumptions";
import type { ValueReportData } from "../../../../lib/usage/value/load";
import { termPeriod } from "../../../../lib/usage/value/periods";
import { compareReports, computeValueReport, emptyCounts, type ValueCounts } from "../../../../lib/usage/value/report";
import { ValueAssumptionsForm } from "./ValueAssumptionsForm";
import { valueReportCsv, valueReportViewModel, type Translate } from "./value-report-model";
import { ValueReportExport } from "./ValueReportExport";
import { ValueReportView } from "./ValueReportView";

const t = createTranslator({ locale: "en", messages: enMessages, namespace: "admin.insights" }) as unknown as Translate;
const NY = "America/New_York";
const assumptions = defaultAssumptions("LAB OPEN 8AM-8PM");
const brand = { assistant: "MakerLAB AI", labName: "MakerLAB Tools · Cornell Tech" };

function data(current: Partial<ValueCounts>, previous: Partial<ValueCounts> = {}): ValueReportData {
  const report = computeValueReport({ ...emptyCounts(), ...current }, assumptions, NY);
  const previousReport = computeValueReport({ ...emptyCounts(), ...previous }, assumptions, NY);
  return {
    period: termPeriod("fall", 2026, assumptions.terms),
    previous: termPeriod("summer", 2026, assumptions.terms),
    toDate: true,
    timeZone: NY,
    today: "2026-09-28",
    assumptions: { assumptions, origin: "default", updatedAt: null, updatedByName: null },
    report,
    previousReport,
    comparison: compareReports(report, previousReport),
    since: "2026-09-21T13:00:00.000Z",
  };
}

const busy = data(
  {
    hourly: [
      { hour: "2026-09-15T14:00:00Z", chatTurns: 30, mcpLookups: 4 },
      { hour: "2026-09-16T02:00:00Z", chatTurns: 20, mcpLookups: 0 },
    ],
    gapsByKind: { not_in_catalog: 3, no_manual_passage: 1, no_search_results: 0, honest_absence: 0 },
    questionKinds: { operate: 25, debug: 10, create: 5, other: 10 },
    topTools: [
      { toolId: "t1", name: "Form 4", slug: "form-4", asked: 20 },
      { toolId: null, name: null, slug: null, asked: 2 },
    ],
    citations: 12,
    manualsCited: 2,
    ticketsFiled: 3,
    ticketsResolved: 2,
    medianDaysToResolve: 1.5,
  },
  { hourly: [{ hour: "2026-07-15T14:00:00Z", chatTurns: 10, mcpLookups: 0 }] }
);

describe("ValueReportView", () => {
  it("titles the report with the assistant, the term and the lab, and says it is an estimate", () => {
    render(<ValueReportView model={valueReportViewModel(busy, t, brand)} />);
    expect(screen.getByRole("heading", { level: 3, name: "MakerLAB AI — Fall 2026 value report" })).toBeInTheDocument();
    expect(screen.getByText("MakerLAB Tools · Cornell Tech")).toBeInTheDocument();
    expect(screen.getByText(/Aug 21, 2026 – Dec 31, 2026 · to date \(through Sep 28, 2026\)/)).toBeInTheDocument();
    expect(screen.getAllByText("Estimate")).toHaveLength(2);
    expect(screen.getByText(/Counting started Sep 21, 2026/)).toBeInTheDocument();
  });

  it("shows the headline numbers with the previous term beside them", () => {
    render(<ValueReportView model={valueReportViewModel(busy, t, brand)} />);
    const metric = (key: string) => document.querySelector(`[data-value-metric="${key}"]`) as HTMLElement;
    expect(within(metric("questionsAnswered")).getByText("52")).toBeInTheDocument();
    expect(within(metric("questionsAnswered")).getByText("vs Summer 2026: ▲ 42 (420%)")).toBeInTheDocument();
    expect(within(metric("handledShare")).getByText("92%")).toBeInTheDocument(); // (50 − 4 + 2) ÷ 52
    expect(within(metric("staffHoursSaved")).getByText("3.2")).toBeInTheDocument(); // 48 × 4 ÷ 60
    expect(within(metric("dollarValue")).getByText("$128")).toBeInTheDocument();
    expect(within(metric("afterHoursShare")).getByText("38%")).toBeInTheDocument(); // 20 ÷ (50 + 4 ÷ 2)
  });

  it("writes every formula out in words with this term's numbers", () => {
    render(<ValueReportView model={valueReportViewModel(busy, t, brand)} />);
    const formulas = within(screen.getByRole("region", { name: "How these numbers are calculated" })).getAllByRole("listitem").map((li) => li.textContent);
    expect(formulas).toHaveLength(5);
    expect(formulas[0]).toContain("= 50 assistant questions in the app + 2 over MCP (4 catalogue lookups by outside assistants ÷ 2 lookups per question, rounded down) = 52");
    expect(formulas[2]).toBe("Staff hours saved ≈ 48 handled questions × 4 minutes a staff member would otherwise spend ÷ 60 = 3.2 hours.");
    expect(formulas[3]).toBe("Estimated value ≈ 3.2 hours × $40 loaded staff cost per hour = $128.");
    expect(formulas[4]).toContain("every day, 8 AM–8 PM, America/New_York");
  });

  it("lists the top tools (a deleted one by that name), kinds and follow-up", () => {
    render(<ValueReportView model={valueReportViewModel(busy, t, brand)} />);
    const tools = screen.getByRole("list", { name: "Most asked-about tools" });
    expect(within(tools).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1.Form 420 questions", "2.Deleted tool2 questions"]);
    expect(document.querySelector('[data-value-row="operate"]')?.textContent).toContain("25 (50%)");
    expect(document.querySelector('[data-value-row="medianDays"]')?.textContent).toContain("1.5 days");
    expect(screen.getByText(/Assumptions set by the lab: 4 min of staff time per question · \$40 per staff hour/)).toBeInTheDocument();
    expect(screen.getByText("These are the defaults; the lab has not set its own.")).toBeInTheDocument();
  });

  it("with no data, shows dashes and zeros, never NaN, and says so in the comparison", () => {
    render(<ValueReportView model={valueReportViewModel(data({}), t, brand)} />);
    const article = document.querySelector("[data-value-report]") as HTMLElement;
    expect(article.textContent).not.toMatch(/NaN|Infinity|undefined/);
    expect(within(document.querySelector('[data-value-metric="handledShare"]') as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(within(document.querySelector('[data-value-metric="questionsAnswered"]') as HTMLElement).getByText("vs Summer 2026: no change")).toBeInTheDocument();
    expect(screen.getByText("No tool was asked about in this period.")).toBeInTheDocument();
  });
});

describe("the CSV", () => {
  it("carries the headline numbers for both terms, the formulas' inputs and the assumptions", () => {
    const { csv, fileName } = valueReportCsv(busy, "MakerLAB AI — Fall 2026 value report", t);
    expect(fileName).toBe("makerlab-ai-fall-2026-value-report.csv");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Section,Metric,Fall 2026,Summer 2026,Note");
    expect(lines).toContain("Headline,Questions answered,52,10,");
    expect(lines).toContain("Headline,Staff hours saved (estimate),3.2,0.7,handled x 4 min / 60");
    expect(lines).toContain("Headline,Estimated value (USD),128,27,hours x 40 per hour");
    expect(lines).toContain("Assumptions,Minutes of staff time per question,4,,");
    expect(csv).not.toMatch(/@|NaN/);
  });
});

describe("ValueReportExport", () => {
  it("prints through the browser, and downloads the CSV it was given", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    const createObjectURL = vi.fn(() => "blob:report");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<ValueReportExport csv={"a,b\r\n"} fileName="report.csv" />);
    await userEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("report.csv");
    print.mockRestore();
    click.mockRestore();
  });
});

describe("ValueAssumptionsForm", () => {
  beforeEach(() => refresh.mockClear());

  it("saves the whole set through its action, and says Saved", async () => {
    const save = vi.fn<(input: typeof assumptions) => Promise<{ ok: true }>>(async () => ({ ok: true }));
    render(<ValueAssumptionsForm assumptions={assumptions} defaults={assumptions} canEdit timeZone={NY} save={save} />);
    const minutes = screen.getByLabelText("Minutes of staff time per question");
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "6");
    await userEvent.click(screen.getByRole("checkbox", { name: "Sun" }));
    await userEvent.click(screen.getByRole("button", { name: "Save assumptions" }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ minutesPerQuestion: 6, hourlyCost: 40, staffedHours: { days: [1, 2, 3, 4, 5, 6] } });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("names an overlapping term before sending anything", async () => {
    const save = vi.fn();
    render(<ValueAssumptionsForm assumptions={assumptions} defaults={assumptions} canEdit timeZone={NY} save={save} />);
    const springEnd = screen.getByLabelText("Spring ends");
    await userEvent.clear(springEnd);
    await userEvent.type(springEnd, "06-30");
    await userEvent.click(screen.getByRole("button", { name: "Save assumptions" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Two terms overlap.");
  });

  it("shows a refusal from the server", async () => {
    const save = vi.fn(async () => ({ ok: false as const, error: "not_permitted" as const }));
    render(<ValueAssumptionsForm assumptions={assumptions} defaults={assumptions} canEdit timeZone={NY} save={save} />);
    await userEvent.click(screen.getByRole("button", { name: "Save assumptions" }));
    expect(await screen.findByText(/not permitted|permission/i)).toBeInTheDocument();
  });

  it("is read-only without the permission: every field disabled, no Save", () => {
    render(<ValueAssumptionsForm assumptions={assumptions} defaults={assumptions} canEdit={false} timeZone={NY} save={vi.fn()} />);
    expect(screen.getByText("Only admins and super admins can change these.")).toBeInTheDocument();
    expect(screen.getByLabelText("Minutes of staff time per question")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save assumptions" })).toBeNull();
  });

  it("Reset to defaults fills the form without saving", async () => {
    const save = vi.fn();
    render(<ValueAssumptionsForm assumptions={{ ...assumptions, minutesPerQuestion: 9 }} defaults={assumptions} canEdit timeZone={NY} save={save} />);
    expect(screen.getByLabelText("Minutes of staff time per question")).toHaveValue(9);
    await userEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByLabelText("Minutes of staff time per question")).toHaveValue(4);
    expect(save).not.toHaveBeenCalled();
  });
});
