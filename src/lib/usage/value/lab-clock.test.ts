// @vitest-environment node
import { addDays, daysBetween, isIsoDate, labClock, labMidnight, labOffsetMs } from "./lab-clock";

const NY = "America/New_York";

describe("the lab's clock", () => {
  it("puts 01:30 UTC on a summer Tuesday at 21:30 Monday in New York (EDT, −4)", () => {
    expect(labClock(new Date("2026-09-29T01:30:00Z"), NY)).toEqual({ date: "2026-09-28", dow: 1, hour: 21 });
  });

  it("puts 01:30 UTC on a winter Wednesday at 20:30 Tuesday in New York (EST, −5)", () => {
    expect(labClock(new Date("2026-12-02T01:30:00Z"), NY)).toEqual({ date: "2026-12-01", dow: 2, hour: 20 });
  });

  it("counts the repeated hour on the fall-back night once each time it happens", () => {
    // 2026-11-01: 01:00 EDT happens at 05:00 UTC, and 01:00 EST again at 06:00 UTC.
    expect(labClock(new Date("2026-11-01T05:30:00Z"), NY).hour).toBe(1);
    expect(labClock(new Date("2026-11-01T06:30:00Z"), NY).hour).toBe(1);
    expect(labClock(new Date("2026-11-01T07:30:00Z"), NY).hour).toBe(2);
  });

  it("skips the missing hour on the spring-forward night", () => {
    // 2027-03-14: 02:00 EST jumps to 03:00 EDT at 07:00 UTC.
    expect(labClock(new Date("2027-03-14T06:30:00Z"), NY).hour).toBe(1);
    expect(labClock(new Date("2027-03-14T07:30:00Z"), NY).hour).toBe(3);
  });

  it("knows the offset either side of DST", () => {
    expect(labOffsetMs(new Date("2026-07-01T12:00:00Z"), NY)).toBe(-4 * 3_600_000);
    expect(labOffsetMs(new Date("2026-12-01T12:00:00Z"), NY)).toBe(-5 * 3_600_000);
    expect(labOffsetMs(new Date("2026-07-01T12:00:00Z"), "UTC")).toBe(0);
  });
});

describe("lab midnight", () => {
  it("is 04:00 UTC in summer and 05:00 UTC in winter for New York", () => {
    expect(labMidnight("2026-08-21", NY).toISOString()).toBe("2026-08-21T04:00:00.000Z");
    expect(labMidnight("2027-01-01", NY).toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("is right on both changeover days", () => {
    expect(labMidnight("2026-11-01", NY).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(labMidnight("2026-11-02", NY).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(labMidnight("2027-03-14", NY).toISOString()).toBe("2027-03-14T05:00:00.000Z");
    expect(labMidnight("2027-03-15", NY).toISOString()).toBe("2027-03-15T04:00:00.000Z");
  });

  it("works east of UTC too", () => {
    expect(labMidnight("2026-09-28", "Asia/Kolkata").toISOString()).toBe("2026-09-27T18:30:00.000Z");
  });
});

describe("calendar dates", () => {
  it("adds days across months, years and leap days", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-08-21", "2026-12-31")).toBe(132);
  });

  it("knows a real date", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate(20260228)).toBe(false);
  });
});
