import { DEFAULT_LAB_TIMEZONE, labTimezone, labToday } from "./lab-time";

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
