// @vitest-environment node
import { labToday } from "../lab-time";
import {
  addInterval,
  daysBetween,
  dueState,
  isIsoDate,
  isValidInterval,
  nextDueAfterDone,
  overdueDays,
} from "./interval";

/**
 * The date maths of recurring maintenance (recurring maintenance spec §10):
 * month-end clamping, leap years, daylight saving in the lab's timezone, and
 * where a due date stands on a given day. "Embarrassing in production": a task
 * dated tomorrow because of UTC — the last block pins that.
 */

describe("addInterval", () => {
  it("adds days and weeks", () => {
    expect(addInterval("2026-10-06", { count: 1, unit: "day" })).toBe("2026-10-07");
    expect(addInterval("2026-10-06", { count: 2, unit: "week" })).toBe("2026-10-20");
    expect(addInterval("2026-12-28", { count: 7, unit: "day" })).toBe("2027-01-04");
  });

  it("clamps a month step to the month's end", () => {
    expect(addInterval("2026-01-31", { count: 1, unit: "month" })).toBe("2026-02-28");
    expect(addInterval("2026-08-31", { count: 1, unit: "month" })).toBe("2026-09-30");
    expect(addInterval("2026-03-31", { count: 3, unit: "month" })).toBe("2026-06-30");
  });

  it("knows leap years", () => {
    expect(addInterval("2028-01-31", { count: 1, unit: "month" })).toBe("2028-02-29");
    expect(addInterval("2027-02-28", { count: 1, unit: "day" })).toBe("2027-03-01");
    expect(addInterval("2028-02-28", { count: 1, unit: "day" })).toBe("2028-02-29");
    expect(addInterval("2028-02-29", { count: 12, unit: "month" })).toBe("2029-02-28");
  });

  it("crosses years by months", () => {
    expect(addInterval("2026-11-15", { count: 3, unit: "month" })).toBe("2027-02-15");
    expect(addInterval("2026-10-06", { count: 24, unit: "month" })).toBe("2028-10-06");
  });

  it("is not moved by daylight saving (calendar days, not hours)", () => {
    // US clocks fall back on 1 Nov 2026 and spring forward on 14 Mar 2027.
    expect(addInterval("2026-10-31", { count: 1, unit: "day" })).toBe("2026-11-01");
    expect(addInterval("2026-11-01", { count: 1, unit: "day" })).toBe("2026-11-02");
    expect(addInterval("2027-03-13", { count: 1, unit: "day" })).toBe("2027-03-14");
    expect(addInterval("2027-03-08", { count: 1, unit: "week" })).toBe("2027-03-15");
  });

  it("refuses a date or an interval that is not one", () => {
    expect(() => addInterval("2026-02-30", { count: 1, unit: "day" })).toThrow(RangeError);
    expect(() => addInterval("2026-10-06", { count: 0, unit: "day" })).toThrow(RangeError);
    expect(() => addInterval("2026-10-06", { count: 1.5, unit: "week" })).toThrow(RangeError);
  });
});

describe("validation", () => {
  it("accepts only real YYYY-MM-DD dates", () => {
    expect(isIsoDate("2026-10-06")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("2026-10-6")).toBe(false);
    expect(isIsoDate("10/06/2026")).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });

  it("holds intervals to 1–730 whole days, weeks or months", () => {
    expect(isValidInterval({ count: 1, unit: "day" })).toBe(true);
    expect(isValidInterval({ count: 730, unit: "month" })).toBe(true);
    expect(isValidInterval({ count: 731, unit: "day" })).toBe(false);
    expect(isValidInterval({ count: 0, unit: "week" })).toBe(false);
    expect(isValidInterval({ count: 2, unit: "year" })).toBe(false);
    expect(isValidInterval({ count: "2", unit: "day" })).toBe(false);
  });
});

describe("overdue and due states", () => {
  it("counts whole days between dates", () => {
    expect(daysBetween("2026-10-06", "2026-10-09")).toBe(3);
    expect(daysBetween("2026-10-09", "2026-10-06")).toBe(-3);
    // Across the autumn clock change: still whole days.
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("is 0 days overdue on the due day and 1 the day after", () => {
    expect(overdueDays("2026-10-06", "2026-10-05")).toBe(0);
    expect(overdueDays("2026-10-06", "2026-10-06")).toBe(0);
    expect(overdueDays("2026-10-06", "2026-10-07")).toBe(1);
    expect(overdueDays("2026-10-03", "2026-10-06")).toBe(3);
  });

  it("says overdue, today, soon or later", () => {
    expect(dueState("2026-10-05", "2026-10-06")).toBe("overdue");
    expect(dueState("2026-10-06", "2026-10-06")).toBe("today");
    expect(dueState("2026-10-07", "2026-10-06")).toBe("soon");
    expect(dueState("2026-10-13", "2026-10-06")).toBe("soon");
    expect(dueState("2026-10-14", "2026-10-06")).toBe("later");
    expect(dueState("2026-10-08", "2026-10-06", 1)).toBe("later");
  });
});

describe("nextDueAfterDone (floating, spec §13 Q1)", () => {
  it("counts from the day it was done, late or early", () => {
    // Due Monday 5 Oct, weekly, done three days late on Thursday 8 Oct.
    expect(nextDueAfterDone("2026-10-08", { count: 1, unit: "week" })).toBe("2026-10-15");
    // Done a day early: next week from the early day.
    expect(nextDueAfterDone("2026-10-04", { count: 1, unit: "week" })).toBe("2026-10-11");
    expect(nextDueAfterDone("2026-01-31", { count: 1, unit: "month" })).toBe("2026-02-28");
  });
});

describe("in the lab's timezone (the 'dated tomorrow because of UTC' case)", () => {
  beforeEach(() => vi.stubEnv("LAB_TIMEZONE", "America/New_York"));
  afterEach(() => vi.unstubAllEnvs());

  it("keeps a task due today 'today' at 11:30pm in New York, when UTC is already tomorrow", () => {
    // 23:30 EDT on Tuesday 6 Oct is 03:30 UTC on Wednesday 7 Oct.
    const today = labToday(new Date("2026-10-07T03:30:00Z"));
    expect(today).toBe("2026-10-06");
    expect(dueState("2026-10-06", today)).toBe("today");
    expect(overdueDays("2026-10-06", today)).toBe(0);
    // Checked off then, it is next due a week after the lab's Tuesday.
    expect(nextDueAfterDone(today, { count: 1, unit: "week" })).toBe("2026-10-13");
  });

  it("dates the night the clocks fall back by the lab's calendar", () => {
    // 23:30 EDT on Saturday 31 Oct; clocks fall back at 02:00 on Sunday 1 Nov.
    const saturday = labToday(new Date("2026-11-01T03:30:00Z"));
    expect(saturday).toBe("2026-10-31");
    // 23:30 EST on Sunday 1 Nov is 04:30 UTC on Monday 2 Nov.
    const sunday = labToday(new Date("2026-11-02T04:30:00Z"));
    expect(sunday).toBe("2026-11-01");
    expect(daysBetween(saturday, sunday)).toBe(1);
    expect(dueState("2026-10-31", sunday)).toBe("overdue");
    expect(overdueDays("2026-10-31", sunday)).toBe(1);
  });

  it("dates the morning the clocks spring forward by the lab's calendar", () => {
    // 00:30 EST on Sunday 14 Mar 2027 is 05:30 UTC.
    expect(labToday(new Date("2027-03-14T05:30:00Z"))).toBe("2027-03-14");
    // 04:30 UTC is still Saturday evening in New York.
    expect(labToday(new Date("2027-03-14T04:30:00Z"))).toBe("2027-03-13");
  });
});
