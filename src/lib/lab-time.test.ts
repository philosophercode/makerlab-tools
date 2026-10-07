import { DEFAULT_LAB_TIMEZONE, labDateLabel, labInstant, labTimeOfDay, labTimezone, labToday } from "./lab-time";

/**
 * Pure `Intl`: no env beyond the stub under test, no database, no network.
 *
 * The instant that matters is the one either side of midnight — that is the
 * whole reason this helper exists rather than `toISOString().split("T")[0]`.
 */

// 2026-09-22T01:30:00Z is 2026-09-21 21:30 in New York (EDT, UTC-4).
const LATE_EVENING_EDT = new Date("2026-09-22T01:30:00.000Z");
// 2026-01-15T04:30:00Z is 2026-01-14 23:30 in New York (EST, UTC-5).
const LATE_EVENING_EST = new Date("2026-01-15T04:30:00.000Z");

describe("labToday", () => {
  it("dates a late-evening instant by the lab's day, not UTC's", () => {
    vi.stubEnv("LAB_TIMEZONE", "");

    expect(labToday(LATE_EVENING_EDT)).toBe("2026-09-21");
    expect(LATE_EVENING_EDT.toISOString().slice(0, 10)).toBe("2026-09-22");
  });

  it("follows daylight saving, because the offset is not a constant", () => {
    vi.stubEnv("LAB_TIMEZONE", "");

    // -4 in September, -5 in January; both land on the previous local day.
    expect(labToday(LATE_EVENING_EST)).toBe("2026-01-14");
  });

  it("uses the configured timezone when one is set", () => {
    vi.stubEnv("LAB_TIMEZONE", "Asia/Tokyo");

    // 01:30Z on the 22nd is already 10:30 on the 22nd in Tokyo.
    expect(labToday(LATE_EVENING_EDT)).toBe("2026-09-22");
  });

  it("pads single-digit months and days", () => {
    vi.stubEnv("LAB_TIMEZONE", "UTC");

    expect(labToday(new Date("2026-03-07T12:00:00.000Z"))).toBe("2026-03-07");
  });

  it("falls back to UTC on a timezone Intl does not recognise, rather than throwing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("LAB_TIMEZONE", "Mars/Olympus_Mons");

    // A typo in an env var must not cost a student their maintenance report.
    expect(labToday(LATE_EVENING_EDT)).toBe("2026-09-22");
    expect(warn).toHaveBeenCalled();
  });
});

describe("labTimezone", () => {
  it("defaults to the lab's timezone when unset or blank", () => {
    vi.stubEnv("LAB_TIMEZONE", "");
    expect(labTimezone()).toBe(DEFAULT_LAB_TIMEZONE);

    vi.stubEnv("LAB_TIMEZONE", "   ");
    expect(labTimezone()).toBe(DEFAULT_LAB_TIMEZONE);
  });

  it("trims a configured value", () => {
    vi.stubEnv("LAB_TIMEZONE", "  Europe/Berlin  ");
    expect(labTimezone()).toBe("Europe/Berlin");
  });
});

// The daily maintenance reminder goes at 08:00 lab time (email notifications
// spec, amendment 2026-10-07), so a wall-clock time must become the right
// instant on either side of a daylight-saving change.
describe("labInstant", () => {
  it("is 08:00 New York time in summer (UTC-4) and in winter (UTC-5)", () => {
    vi.stubEnv("LAB_TIMEZONE", "");
    expect(labInstant("2026-10-07", 8).toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(labInstant("2026-01-15", 8).toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("lands on the right side of the spring and autumn changes", () => {
    vi.stubEnv("LAB_TIMEZONE", "America/New_York");
    // 2026-03-08: clocks go forward at 02:00. 2026-11-01: back at 02:00.
    expect(labInstant("2026-03-08", 8).toISOString()).toBe("2026-03-08T12:00:00.000Z");
    expect(labInstant("2026-11-01", 8).toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  it("follows the configured timezone, and falls back to UTC for one Intl does not know", () => {
    vi.stubEnv("LAB_TIMEZONE", "Europe/Berlin");
    expect(labInstant("2026-10-07", 8).toISOString()).toBe("2026-10-07T06:00:00.000Z");
    vi.stubEnv("LAB_TIMEZONE", "Mars/Olympus_Mons");
    expect(labInstant("2026-10-07", 8).toISOString()).toBe("2026-10-07T08:00:00.000Z");
  });
});

describe("labTimeOfDay and labDateLabel", () => {
  it("writes the lab's clock time and a calendar date out for an email", () => {
    vi.stubEnv("LAB_TIMEZONE", "");
    expect(labTimeOfDay(new Date("2026-10-07T20:12:00Z"))).toBe("4:12 PM");
    expect(labDateLabel("2026-10-07")).toBe("Wednesday, October 7");
  });
});
