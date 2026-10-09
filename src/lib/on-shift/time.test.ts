import { DEFAULT_SHIFT_END, isShiftOn, labClockTime, labTimeToday, SHIFT_TIME_PATTERN } from "./time";

/**
 * When a shift ends (on-shift spec 2026-10-07 §5): "HH:MM" is today in the
 * lab's timezone, whatever the server's clock or the browser's timezone, and a
 * shift is on until that instant and not one millisecond after.
 */

const NY = "America/New_York";

describe("labTimeToday", () => {
  it("reads the time as today in the lab's timezone, in summer (EDT, UTC-4)", () => {
    // 10:00 in New York on 7 October.
    const now = new Date("2026-10-07T14:00:00Z");
    expect(labTimeToday("18:00", now, NY)?.toISOString()).toBe("2026-10-07T22:00:00.000Z");
    expect(labTimeToday(DEFAULT_SHIFT_END, now, NY)?.toISOString()).toBe("2026-10-08T03:59:00.000Z");
  });

  it("reads the time as today in the lab's timezone, in winter (EST, UTC-5)", () => {
    const now = new Date("2026-12-01T15:00:00Z");
    expect(labTimeToday("18:00", now, NY)?.toISOString()).toBe("2026-12-01T23:00:00.000Z");
  });

  it("takes the lab's date, not the server's: 9pm in New York is still today there, though it is tomorrow in UTC", () => {
    // 21:00 on 7 October in New York is 01:00 on 8 October UTC.
    const now = new Date("2026-10-08T01:00:00Z");
    expect(labTimeToday("23:00", now, NY)?.toISOString()).toBe("2026-10-08T03:00:00.000Z");
  });

  it("gets the day daylight saving ends right (1 November 2026)", () => {
    const now = new Date("2026-11-01T12:00:00Z"); // 07:00 EST, after the change
    expect(labTimeToday("18:00", now, NY)?.toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });

  it("works in another lab's timezone", () => {
    const now = new Date("2026-10-07T08:00:00Z");
    expect(labTimeToday("17:30", now, "Europe/Berlin")?.toISOString()).toBe("2026-10-07T15:30:00.000Z");
  });

  it("falls back to UTC for a timezone Intl does not know, rather than refusing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = new Date("2026-10-07T08:00:00Z");
    expect(labTimeToday("17:30", now, "Mars/Olympus")?.toISOString()).toBe("2026-10-07T17:30:00.000Z");
    warn.mockRestore();
  });

  it.each(["", "6pm", "24:00", "18:60", "18:00:00", "8:00", " 18:00"])("is null for %j, which is not a time", (value) => {
    expect(labTimeToday(value, new Date("2026-10-07T14:00:00Z"), NY)).toBeNull();
    expect(SHIFT_TIME_PATTERN.test(value)).toBe(false);
  });
});

describe("isShiftOn — a shift ends by itself", () => {
  const ends = "2026-10-07T22:00:00.000Z";

  it("is on before the end, and off at it and after it", () => {
    expect(isShiftOn(ends, new Date("2026-10-07T21:59:59.999Z"))).toBe(true);
    expect(isShiftOn(ends, new Date(ends))).toBe(false);
    expect(isShiftOn(ends, new Date("2026-10-08T09:00:00Z"))).toBe(false);
  });

  it("takes a Date as well as text", () => {
    expect(isShiftOn(new Date(ends), new Date("2026-10-07T20:00:00Z"))).toBe(true);
  });

  it("is off for no end and for an end that is not a date", () => {
    expect(isShiftOn(null)).toBe(false);
    expect(isShiftOn(undefined)).toBe(false);
    expect(isShiftOn("not a date")).toBe(false);
  });
});

describe("labClockTime", () => {
  it("shows an instant as HH:MM on the lab's clock", () => {
    expect(labClockTime("2026-10-07T22:00:00.000Z", NY)).toBe("18:00");
    expect(labClockTime(new Date("2026-10-08T03:59:00.000Z"), NY)).toBe("23:59");
  });

  it("round-trips with labTimeToday", () => {
    const now = new Date("2026-10-07T14:00:00Z");
    expect(labClockTime(labTimeToday("07:05", now, NY)!, NY)).toBe("07:05");
  });
});
