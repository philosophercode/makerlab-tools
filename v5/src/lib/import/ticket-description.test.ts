import { parseTicketDescription } from "./ticket-description";

const TEMPLATE = [
  "**What happened**\nThe resin tank looks cloudy after the last print.",
  "**Reported by**\nAda Lovelace",
  "**Date reported**\n2024-09-01",
  "**Priority**\nMedium",
].join("\n\n");

describe("parseTicketDescription", () => {
  it("splits the exact template back into columns", () => {
    expect(parseTicketDescription(TEMPLATE)).toEqual({
      description: "The resin tank looks cloudy after the last print.",
      reportedBy: "Ada Lovelace",
      dateReported: "2024-09-01",
      priority: "Medium",
      templated: true,
      exact: true,
    });
  });

  it("handles a template with only some sections", () => {
    const text = "**What happened**\nBelt slipping.\n\n**Priority**\nHigh";
    expect(parseTicketDescription(text)).toEqual({
      description: "Belt slipping.",
      reportedBy: null,
      dateReported: null,
      priority: "High",
      templated: true,
      exact: true,
    });
  });

  it("keeps free text whole and reports that no template was found", () => {
    expect(parseTicketDescription("Nozzle is clogged again.")).toEqual({
      description: "Nozzle is clogged again.",
      reportedBy: null,
      dateReported: null,
      priority: null,
      templated: false,
      exact: false,
    });
  });

  it("keeps the whole text as the description when a person edited around the template, but still fills the columns", () => {
    const edited = `Note from staff: checked twice.\n\n${TEMPLATE}`;
    const parsed = parseTicketDescription(edited);
    expect(parsed.templated).toBe(true);
    expect(parsed.exact).toBe(false);
    expect(parsed.description).toBe(edited);
    expect(parsed.reportedBy).toBe("Ada Lovelace");
    expect(parsed.dateReported).toBe("2024-09-01");
    expect(parsed.priority).toBe("Medium");
  });

  it("treats a repeated heading as not the template", () => {
    const text = "**Priority**\nLow\n\n**Priority**\nHigh";
    const parsed = parseTicketDescription(text);
    expect(parsed.exact).toBe(false);
    expect(parsed.description).toBe(text);
  });

  it("returns nulls for empty input", () => {
    expect(parseTicketDescription("")).toEqual({
      description: null,
      reportedBy: null,
      dateReported: null,
      priority: null,
      templated: false,
      exact: true,
    });
    expect(parseTicketDescription(undefined).description).toBeNull();
  });

  it("tolerates Windows line endings", () => {
    const parsed = parseTicketDescription(TEMPLATE.replace(/\n/g, "\r\n"));
    expect(parsed.exact).toBe(true);
    expect(parsed.priority).toBe("Medium");
  });
});
