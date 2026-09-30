import { render, screen, within } from "../../../test/utils/render";
import { StarterAnswerTable, type StarterChipRow } from "./StarterAnswerTable";

const rows: StarterChipRow[] = [
  { id: "g-0", toolName: null, toolSlug: null, question: "How do I start a print?", status: "cached", score: 8, reasons: [] },
  { id: "t-0", toolName: "Form 4", toolSlug: "form-4", question: "Is it free now?", status: "rejected", score: 4, reasons: ["not stable"] },
  { id: "t-1", toolName: "Form 4", toolSlug: "form-4", question: "What resins?", status: "stale", score: 9, reasons: [] },
  { id: "t-2", toolName: "Form 4", toolSlug: "form-4", question: "Never asked?", status: "live", score: null, reasons: [] },
];

describe("StarterAnswerTable", () => {
  it("lists every chip with its tool, status and grade", () => {
    render(<StarterAnswerTable rows={rows} />);
    const table = screen.getByRole("table", { name: "Starter chips, their tool and whether they answer from the cache" });
    expect(within(table).getByText("General chips")).toBeInTheDocument();
    expect(within(table).getAllByRole("link", { name: "Form 4" })[0]).toHaveAttribute("href", "/tools/form-4");
    for (const status of ["Cached", "Graded down", "Stale", "Live"]) expect(within(table).getByText(status)).toBeInTheDocument();
    expect(within(table).getByText("4/10")).toHaveAttribute("title", "not stable");
  });

  it("says so when there are no chips", () => {
    render(<StarterAnswerTable rows={[]} />);
    expect(screen.getByText("No starter chips yet.")).toBeInTheDocument();
  });
});
