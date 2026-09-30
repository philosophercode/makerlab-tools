// @vitest-environment node
import { DEFAULT_TERMS, type TermWindow } from "./assumptions";
import { parsePeriod, periodBounds, periodQuery, previousPeriod, recentTerms, termFor, termPeriod } from "./periods";

const NY = "America/New_York";

describe("terms", () => {
  it("finds the term a date falls in, at both of its edges", () => {
    expect(termFor("2026-09-28", DEFAULT_TERMS)).toMatchObject({ key: "fall-2026", from: "2026-08-21", to: "2026-12-31" });
    expect(termFor("2026-08-21", DEFAULT_TERMS).key).toBe("fall-2026");
    expect(termFor("2026-08-20", DEFAULT_TERMS).key).toBe("summer-2026");
    expect(termFor("2027-01-01", DEFAULT_TERMS).key).toBe("spring-2027");
    expect(termFor("2026-05-20", DEFAULT_TERMS).key).toBe("spring-2026");
  });

  it("puts a day between two terms in the one that started last", () => {
    const gappy: TermWindow[] = [
      { kind: "spring", start: "01-20", end: "05-15" },
      { kind: "summer", start: "06-01", end: "08-10" },
      { kind: "fall", start: "08-25", end: "12-20" },
    ];
    expect(termFor("2026-05-25", gappy).key).toBe("spring-2026");
    expect(termFor("2026-12-28", gappy).key).toBe("fall-2026");
    // Before the year's first term: last year's final one.
    expect(termFor("2027-01-05", gappy).key).toBe("fall-2026");
  });

  it("steps back a term, across the new year", () => {
    expect(previousPeriod(termPeriod("fall", 2026, DEFAULT_TERMS), DEFAULT_TERMS).key).toBe("summer-2026");
    expect(previousPeriod(termPeriod("spring", 2027, DEFAULT_TERMS), DEFAULT_TERMS).key).toBe("fall-2026");
  });

  it("lists the recent terms, newest first", () => {
    expect(recentTerms("2026-09-28", DEFAULT_TERMS, 4).map((p) => p.key)).toEqual(["fall-2026", "summer-2026", "spring-2026", "fall-2025"]);
  });
});

describe("a custom range", () => {
  it("has the same number of days just before it as its previous period", () => {
    const period = parsePeriod({ from: "2026-09-01", to: "2026-09-30" }, DEFAULT_TERMS, "2026-09-28");
    expect(period).toEqual({ kind: "custom", key: "custom", from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod(period, DEFAULT_TERMS)).toMatchObject({ from: "2026-08-02", to: "2026-08-31" });
  });

  it("a single day's previous period is the day before", () => {
    const period = parsePeriod({ from: "2026-03-01", to: "2026-03-01" }, DEFAULT_TERMS, "2026-09-28");
    expect(previousPeriod(period, DEFAULT_TERMS)).toMatchObject({ from: "2026-02-28", to: "2026-02-28" });
  });
});

describe("reading the query string", () => {
  const today = "2026-09-28";
  it("defaults to the current term", () => {
    expect(parsePeriod({}, DEFAULT_TERMS, today).key).toBe("fall-2026");
  });

  it("takes a term that has started, and not one in the future", () => {
    expect(parsePeriod({ term: "spring-2026" }, DEFAULT_TERMS, today).key).toBe("spring-2026");
    expect(parsePeriod({ term: ["summer-2025", "x"] }, DEFAULT_TERMS, today).key).toBe("summer-2025");
    expect(parsePeriod({ term: "spring-2027" }, DEFAULT_TERMS, today).key).toBe("fall-2026");
    expect(parsePeriod({ term: "winter-2026" }, DEFAULT_TERMS, today).key).toBe("fall-2026");
  });

  it("refuses a backwards range, a false date and a range over a year, falling back to the current term", () => {
    expect(parsePeriod({ from: "2026-09-30", to: "2026-09-01" }, DEFAULT_TERMS, today).key).toBe("fall-2026");
    expect(parsePeriod({ from: "2026-02-30", to: "2026-03-01" }, DEFAULT_TERMS, today).key).toBe("fall-2026");
    expect(parsePeriod({ from: "2024-01-01", to: "2026-01-01" }, DEFAULT_TERMS, today).key).toBe("fall-2026");
    expect(parsePeriod({ from: "2026-01-01" }, DEFAULT_TERMS, today).key).toBe("fall-2026");
  });

  it("writes a period back as a query string", () => {
    expect(periodQuery(termPeriod("fall", 2026, DEFAULT_TERMS))).toBe("term=fall-2026");
    expect(periodQuery({ kind: "custom", key: "custom", from: "2026-09-01", to: "2026-09-30" })).toBe("from=2026-09-01&to=2026-09-30");
  });
});

describe("a period's instants", () => {
  it("runs from lab midnight on the first day to lab midnight after the last, across a DST change", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    const bounds = periodBounds({ from: "2026-08-21", to: "2026-12-31" }, NY, now);
    expect(bounds.start.toISOString()).toBe("2026-08-21T04:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2027-01-01T05:00:00.000Z");
    expect(bounds.toDate).toBe(false);
  });

  it("stops at now while the period is still running", () => {
    const now = new Date("2026-09-28T16:00:00Z");
    const bounds = periodBounds({ from: "2026-08-21", to: "2026-12-31" }, NY, now);
    expect(bounds.end.toISOString()).toBe(now.toISOString());
    expect(bounds.toDate).toBe(true);
  });

  it("is empty, not negative, for a period that has not started", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const bounds = periodBounds({ from: "2026-08-21", to: "2026-12-31" }, NY, now);
    expect(bounds.end.getTime()).toBe(bounds.start.getTime());
  });
});
