// @vitest-environment node
import { defaultAssumptions, type ValueAssumptions } from "./assumptions";
import { afterHoursQuestions, compareReports, computeValueReport, emptyCounts, median, type ValueCounts } from "./report";

const NY = "America/New_York";
const assumptions: ValueAssumptions = { ...defaultAssumptions("LAB OPEN 8AM-8PM") };

function counts(patch: Partial<ValueCounts>): ValueCounts {
  return { ...emptyCounts(), ...patch };
}

describe("the value report's arithmetic", () => {
  it("is zeros and nulls, never NaN, with no data", () => {
    const report = computeValueReport(emptyCounts(), assumptions, NY);
    expect(report).toMatchObject({
      questionsAnswered: 0,
      handled: 0,
      handledShare: null,
      staffHoursSaved: 0,
      dollarValue: 0,
      afterHoursQuestions: 0,
      afterHoursShare: null,
      medianDaysToResolve: null,
    });
    expect(JSON.stringify(report)).not.toMatch(/NaN|Infinity/);
  });

  it("counts app questions, MCP questions at two lookups each, and subtracts the unanswered", () => {
    const report = computeValueReport(
      counts({
        // 2026-09-15 is a Tuesday: 14:00 UTC is 10 AM in New York (staffed), 02:00 UTC the next day is 10 PM (not).
        hourly: [
          { hour: "2026-09-15T14:00:00Z", chatTurns: 30, mcpLookups: 5 },
          { hour: "2026-09-16T02:00:00Z", chatTurns: 20, mcpLookups: 0 },
        ],
        gapsByKind: { not_in_catalog: 3, no_manual_passage: 2, no_search_results: 0, honest_absence: 1 },
      }),
      assumptions,
      NY
    );
    expect(report.chatTurns).toBe(50);
    expect(report.mcpLookups).toBe(5);
    expect(report.mcpQuestions).toBe(2); // 5 ÷ 2, rounded down
    expect(report.questionsAnswered).toBe(52);
    expect(report.unanswered).toBe(6);
    expect(report.handled).toBe(46); // 50 − 6 + 2
    expect(report.handledShare).toBeCloseTo(46 / 52);
    expect(report.staffHoursSaved).toBeCloseTo((46 * 4) / 60);
    expect(report.dollarValue).toBeCloseTo(((46 * 4) / 60) * 40);
    expect(report.afterHoursQuestions).toBe(20);
    expect(report.afterHoursShare).toBeCloseTo(20 / (50 + 2.5));
  });

  it("subtracts only the unanswered kinds the lab counts, never below zero", () => {
    const gapsByKind = { not_in_catalog: 3, no_manual_passage: 2, no_search_results: 4, honest_absence: 1 };
    const only = { ...assumptions, unansweredKinds: ["not_in_catalog" as const] };
    expect(computeValueReport(counts({ hourly: [{ hour: "2026-09-15T14:00:00Z", chatTurns: 10, mcpLookups: 0 }], gapsByKind }), only, NY).handled).toBe(7);
    const none = { ...assumptions, unansweredKinds: [] };
    expect(computeValueReport(counts({ hourly: [{ hour: "2026-09-15T14:00:00Z", chatTurns: 10, mcpLookups: 0 }], gapsByKind }), none, NY).handled).toBe(10);
    // More gaps than turns (a gap counted in a turn outside the window) cannot make handled negative.
    expect(computeValueReport(counts({ hourly: [{ hour: "2026-09-15T14:00:00Z", chatTurns: 2, mcpLookups: 0 }], gapsByKind }), assumptions, NY).handled).toBe(0);
  });

  it("leaves MCP out entirely when the lab says so", () => {
    const report = computeValueReport(counts({ hourly: [{ hour: "2026-09-16T02:00:00Z", chatTurns: 0, mcpLookups: 10 }] }), { ...assumptions, includeMcp: false }, NY);
    expect(report).toMatchObject({ mcpLookups: 10, mcpQuestions: 0, questionsAnswered: 0, handledShare: null, afterHoursShare: null });
  });

  it("scales with the lab's minutes and hourly cost", () => {
    const report = computeValueReport(counts({ hourly: [{ hour: "2026-09-15T14:00:00Z", chatTurns: 60, mcpLookups: 0 }] }), { ...assumptions, minutesPerQuestion: 5, hourlyCost: 52.5 }, NY);
    expect(report.staffHoursSaved).toBe(5);
    expect(report.dollarValue).toBe(262.5);
  });
});

describe("after hours, in lab time", () => {
  const weekdays = { ...assumptions, staffedHours: { days: [1, 2, 3, 4, 5], openHour: 8, closeHour: 20 } };
  const at = (hour: string) => [{ hour, chatTurns: 1, mcpLookups: 0 }];

  it("an evening question is after hours whichever side of the DST change it falls", () => {
    // 19:30 local is staffed; 20:xx local is not. Summer (EDT, −4) and winter (EST, −5).
    expect(afterHoursQuestions(at("2026-10-28T23:00:00Z"), weekdays, NY)).toBe(0); // Wed 19:00 EDT
    expect(afterHoursQuestions(at("2026-10-29T00:00:00Z"), weekdays, NY)).toBe(1); // Wed 20:00 EDT
    expect(afterHoursQuestions(at("2026-11-04T00:00:00Z"), weekdays, NY)).toBe(0); // Tue 19:00 EST
    expect(afterHoursQuestions(at("2026-11-04T01:00:00Z"), weekdays, NY)).toBe(1); // Tue 20:00 EST
  });

  it("a morning question at the same UTC hour moves across the open on the changeover", () => {
    // 12:00 UTC is 8 AM EDT (staffed) before the change and 7 AM EST (not) after.
    expect(afterHoursQuestions(at("2026-10-30T12:00:00Z"), weekdays, NY)).toBe(0); // Fri 08:00 EDT
    expect(afterHoursQuestions(at("2026-11-02T12:00:00Z"), weekdays, NY)).toBe(1); // Mon 07:00 EST
  });

  it("a weekend is after hours all day when staff are in on weekdays only", () => {
    expect(afterHoursQuestions(at("2026-10-31T16:00:00Z"), weekdays, NY)).toBe(1); // Sat noon
  });

  it("a question at 23:00 UTC on a Friday is the lab's Friday evening, not Saturday", () => {
    const fridayOnly = { ...assumptions, staffedHours: { days: [5], openHour: 18, closeHour: 21 } };
    expect(afterHoursQuestions(at("2026-10-30T23:00:00Z"), fridayOnly, NY)).toBe(0); // Fri 19:00 EDT
  });
});

describe("comparing with the previous period", () => {
  it("gives the change and the relative change, and nothing relative against a zero", () => {
    const current = computeValueReport(counts({ hourly: [{ hour: "2026-09-15T14:00:00Z", chatTurns: 30, mcpLookups: 0 }] }), assumptions, NY);
    const previous = computeValueReport(counts({ hourly: [{ hour: "2026-06-15T14:00:00Z", chatTurns: 20, mcpLookups: 0 }] }), assumptions, NY);
    const change = compareReports(current, previous);
    expect(change.questionsAnswered).toEqual({ current: 30, previous: 20, delta: 10, relative: 0.5 });
    const fromNothing = compareReports(current, computeValueReport(emptyCounts(), assumptions, NY));
    expect(fromNothing.questionsAnswered.relative).toBeNull();
    expect(fromNothing.handledShare).toMatchObject({ previous: null, delta: null });
  });
});

describe("median", () => {
  it("is the middle value, the mean of the middle two, or null for none", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
