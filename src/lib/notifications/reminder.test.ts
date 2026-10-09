// @vitest-environment node
import { planReminder, REMINDER_HOUR } from "./reminder";

/**
 * When the daily reminder goes (email notifications spec, amendment
 * 2026-10-07): the cron runs at 07:17 UTC, and the run waits for 08:00 on the
 * lab's clock, or sends at once when that has passed.
 */

describe("planReminder", () => {
  beforeEach(() => {
    vi.stubEnv("LAB_TIMEZONE", "America/New_York");
  });

  it("waits from the 07:17 UTC cron until 08:00 in New York", () => {
    expect(REMINDER_HOUR).toBe(8);
    // 07:17 UTC is 03:17 EDT; 08:00 EDT is 12:00 UTC.
    expect(planReminder(new Date("2026-10-07T07:17:00Z"))).toEqual({ labDate: "2026-10-07", waitMs: (4 * 60 + 43) * 60_000 });
    // In winter 07:17 UTC is 02:17 EST; 08:00 EST is 13:00 UTC.
    expect(planReminder(new Date("2026-01-15T07:17:00Z"))).toEqual({ labDate: "2026-01-15", waitMs: (5 * 60 + 43) * 60_000 });
  });

  it("sends at once when 08:00 has passed, dated by the lab's day", () => {
    expect(planReminder(new Date("2026-10-07T15:00:00Z"))).toEqual({ labDate: "2026-10-07", waitMs: 0 });
    // 02:00 UTC on the 8th is still the evening of the 7th in New York.
    expect(planReminder(new Date("2026-10-08T02:00:00Z"))).toEqual({ labDate: "2026-10-07", waitMs: 0 });
  });

  it("takes another hour when asked", () => {
    expect(planReminder(new Date("2026-10-07T07:17:00Z"), 0).waitMs).toBe(0);
  });
});
