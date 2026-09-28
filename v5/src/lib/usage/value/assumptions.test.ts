// @vitest-environment node
import { GAP_KINDS } from "../../db/schema/vocabulary";
import {
  DEFAULT_TERMS,
  defaultAssumptions,
  isMonthDay,
  isStaffedHour,
  normalizeAssumptions,
  resolveAssumptions,
  staffedHoursFromText,
  valueAssumptionsSchema,
} from "./assumptions";

describe("staffed hours from the lab's hours text", () => {
  it("reads the default header line, 8 AM–8 PM every day", () => {
    expect(staffedHoursFromText("LAB OPEN 8AM-8PM")).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], openHour: 8, closeHour: 20 });
  });

  it.each([
    ["Open 9 AM – 5 PM", 9, 17],
    ["9-5PM", 9, 17],
    ["1-5PM", 13, 17],
    ["08:00-22:00", 8, 22],
    ["10am to 8:30pm", 10, 21],
    ["Open until 12 AM from 6 PM: 6PM-12AM", 18, 24],
  ])("reads %s", (text, open, close) => {
    const hours = staffedHoursFromText(text);
    expect([hours.openHour, hours.closeHour]).toEqual([open, close]);
  });

  it("keeps to weekdays when the text says so", () => {
    expect(staffedHoursFromText("Mon–Fri 8AM-6PM").days).toEqual([1, 2, 3, 4, 5]);
    expect(staffedHoursFromText("Weekdays 8AM-6PM").days).toEqual([1, 2, 3, 4, 5]);
  });

  it("falls back to 8 AM–8 PM every day for text it cannot read, or a range that runs backwards", () => {
    expect(staffedHoursFromText("By appointment")).toEqual({ days: [0, 1, 2, 3, 4, 5, 6], openHour: 8, closeHour: 20 });
    expect(staffedHoursFromText("")).toMatchObject({ openHour: 8, closeHour: 20 });
    expect(staffedHoursFromText(null)).toMatchObject({ openHour: 8, closeHour: 20 });
    expect(staffedHoursFromText("8PM-8AM")).toMatchObject({ openHour: 8, closeHour: 20 });
  });
});

describe("the defaults", () => {
  it("are 4 minutes, $40 an hour, contiguous terms, every unanswered kind, MCP at two lookups a question", () => {
    const a = defaultAssumptions("LAB OPEN 8AM-8PM");
    expect(a).toMatchObject({ minutesPerQuestion: 4, hourlyCost: 40, includeMcp: true, mcpCallsPerQuestion: 2 });
    expect(a.unansweredKinds).toEqual([...GAP_KINDS]);
    expect(a.terms).toEqual(DEFAULT_TERMS);
    expect(valueAssumptionsSchema.safeParse(a).success).toBe(true);
  });
});

describe("validation", () => {
  const base = defaultAssumptions();

  it.each([
    ["minutes below range", { minutesPerQuestion: 0 }],
    ["minutes above range", { minutesPerQuestion: 61 }],
    ["a negative cost", { hourlyCost: -1 }],
    ["a close before the open", { staffedHours: { days: [1], openHour: 18, closeHour: 9 } }],
    ["a day that is not a day", { staffedHours: { days: [7], openHour: 8, closeHour: 20 } }],
    ["MCP at zero lookups a question", { mcpCallsPerQuestion: 0 }],
    ["an unknown unanswered kind", { unansweredKinds: ["model_declared"] }],
  ])("refuses %s", (_name, patch) => {
    expect(valueAssumptionsSchema.safeParse({ ...base, ...patch }).success).toBe(false);
  });

  it("refuses overlapping terms, a backwards term, a missing term and a date that is not one", () => {
    const withTerms = (terms: unknown) => valueAssumptionsSchema.safeParse({ ...base, terms });
    expect(withTerms([{ kind: "spring", start: "01-01", end: "06-01" }, { kind: "summer", start: "05-21", end: "08-20" }, { kind: "fall", start: "08-21", end: "12-31" }]).error?.issues[0].message).toBe("terms_overlap");
    expect(withTerms([{ kind: "spring", start: "05-20", end: "01-01" }, ...DEFAULT_TERMS.slice(1)]).success).toBe(false);
    expect(withTerms(DEFAULT_TERMS.slice(0, 2)).success).toBe(false);
    expect(withTerms([{ kind: "spring", start: "02-30", end: "05-20" }, ...DEFAULT_TERMS.slice(1)]).success).toBe(false);
    expect(withTerms([{ kind: "spring", start: "01-01", end: "05-20" }, { kind: "spring", start: "05-21", end: "08-20" }, DEFAULT_TERMS[2]]).success).toBe(false);
  });

  it("knows a month-day, and that 29 February is not one every year", () => {
    expect(isMonthDay("12-31")).toBe(true);
    expect(isMonthDay("02-29")).toBe(false);
    expect(isMonthDay("13-01")).toBe(false);
    expect(isMonthDay("1-1")).toBe(false);
  });
});

describe("resolving what is stored", () => {
  it("uses the defaults when nothing is stored", () => {
    expect(resolveAssumptions(null, "LAB OPEN 9AM-5PM")).toMatchObject({ origin: "default", assumptions: { staffedHours: { openHour: 9, closeHour: 17 } } });
  });

  it("uses a stored value, filling a field it lacks from the defaults", () => {
    const partial: Partial<ReturnType<typeof defaultAssumptions>> = { ...defaultAssumptions(), minutesPerQuestion: 6 };
    delete partial.mcpCallsPerQuestion;
    const resolved = resolveAssumptions(partial);
    expect(resolved.origin).toBe("stored");
    expect(resolved.assumptions).toMatchObject({ minutesPerQuestion: 6, mcpCallsPerQuestion: 2 });
  });

  it("falls back to the defaults, and says so, when a stored value no longer parses", () => {
    expect(resolveAssumptions({ minutesPerQuestion: "four" }).origin).toBe("invalid");
    expect(resolveAssumptions([1, 2]).origin).toBe("invalid");
    expect(resolveAssumptions("text").origin).toBe("invalid");
  });

  it("normalises: days sorted and unique, terms by start, kinds in vocabulary order", () => {
    const a = normalizeAssumptions({
      ...defaultAssumptions(),
      staffedHours: { days: [5, 1, 1, 3], openHour: 8, closeHour: 20 },
      terms: [...DEFAULT_TERMS].reverse(),
      unansweredKinds: ["honest_absence", "not_in_catalog"],
    });
    expect(a.staffedHours.days).toEqual([1, 3, 5]);
    expect(a.terms.map((t) => t.kind)).toEqual(["spring", "summer", "fall"]);
    expect(a.unansweredKinds).toEqual(["not_in_catalog", "honest_absence"]);
  });
});

describe("a staffed hour", () => {
  const hours = { days: [1, 2, 3, 4, 5], openHour: 8, closeHour: 20 };
  it("is inside the open hour and before the close, on a staffed day", () => {
    expect(isStaffedHour(hours, 1, 8)).toBe(true);
    expect(isStaffedHour(hours, 1, 19)).toBe(true);
    expect(isStaffedHour(hours, 1, 20)).toBe(false);
    expect(isStaffedHour(hours, 1, 7)).toBe(false);
    expect(isStaffedHour(hours, 0, 12)).toBe(false);
  });
});
