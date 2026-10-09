// @vitest-environment node
import { csvCell, csvFileName, toCsv } from "./csv";
import { formatHour, formatHours, formatLabDate, formatMoney, formatPercent } from "./format";

describe("CSV", () => {
  it("quotes commas, quotes and line breaks, and leaves plain values alone", () => {
    expect(csvCell("Form 4")).toBe("Form 4");
    expect(csvCell("Trotec, Speedy")).toBe('"Trotec, Speedy"');
    expect(csvCell('the "big" one')).toBe('"the ""big"" one"');
    expect(csvCell(12)).toBe("12");
    expect(csvCell(null)).toBe("");
  });

  it("defuses a cell a spreadsheet would run as a formula, but not a negative number", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-3")).toBe("-3");
  });

  it("writes a header and one CRLF line per row", () => {
    const csv = toCsv(["Section", "Metric", "Fall 2026", "Summer 2026", "Note"], [{ section: "Headline", metric: "Questions answered", current: 52, previous: 40 }]);
    expect(csv).toBe("Section,Metric,Fall 2026,Summer 2026,Note\r\nHeadline,Questions answered,52,40,\r\n");
  });

  it("names the file after the report", () => {
    expect(csvFileName("MakerLAB AI — Fall 2026 value report")).toBe("makerlab-ai-fall-2026-value-report.csv");
    expect(csvFileName("———")).toBe("value-report.csv");
  });
});

describe("formatting", () => {
  it("writes hours, dollars, shares, clock hours and dates the same way everywhere", () => {
    expect(formatHours(3.0666)).toBe("3.1");
    expect(formatMoney(1234.4)).toBe("$1,234");
    expect(formatPercent(0.884)).toBe("88%");
    expect(formatPercent(null)).toBeNull();
    expect([0, 8, 12, 20, 24].map(formatHour)).toEqual(["12 AM", "8 AM", "12 PM", "8 PM", "12 AM"]);
    expect(formatLabDate("2026-08-21")).toBe("Aug 21, 2026");
  });
});
