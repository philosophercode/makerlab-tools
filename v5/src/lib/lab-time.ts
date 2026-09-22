/**
 * Dates in the lab's timezone (data platform design spec §3.11, §4.8).
 *
 * `maintenance_logs.date_reported` is a `date`, and §4.8 says it is "computed
 * in `LAB_TIMEZONE`, never from the server clock". The distinction is not
 * pedantic: a Vercel function runs in UTC, so a ticket filed at 9pm on a
 * Tuesday in New York is 01:00 Wednesday UTC, and `new Date().toISOString()`
 * would date it *tomorrow* — a day staff would then not find it under.
 *
 * `LAB_TIMEZONE` is configuration rather than a constant (Article 6): the code
 * is white-labelled and the next lab to run it is not in New York.
 *
 * No `"server-only"` and no `@/` alias: `src/lib/data/*` imports this, and
 * `scripts/` loads those modules under plain Node.
 */

/** Cornell Tech's timezone — the default when `LAB_TIMEZONE` is unset. */
export const DEFAULT_LAB_TIMEZONE = "America/New_York";

/** The configured lab timezone, or the default. */
export function labTimezone(): string {
  return process.env.LAB_TIMEZONE?.trim() || DEFAULT_LAB_TIMEZONE;
}

/**
 * Today's date in the lab's timezone, as `YYYY-MM-DD` — the shape a Postgres
 * `date` column takes as a string.
 *
 * A timezone `Intl` does not recognise falls back to UTC with a warning rather
 * than throwing: a typo in an environment variable must not be able to lose a
 * student's maintenance report (Article 4).
 */
export function labToday(now: Date = new Date()): string {
  const timeZone = labTimezone();
  try {
    return formatIsoDate(now, timeZone);
  } catch (err) {
    console.warn(
      `[lab-time] LAB_TIMEZONE="${timeZone}" is not a timezone Intl recognises — dating in UTC instead.`,
      err
    );
    return formatIsoDate(now, "UTC");
  }
}

/**
 * `Intl` rather than arithmetic on the epoch, because the offset depends on the
 * date (daylight saving) and only the runtime's timezone database knows it.
 * Parts are reassembled by name; `en-CA` happens to render ISO order, but
 * relying on a locale's format string is how this breaks on a different ICU
 * build.
 */
function formatIsoDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);

  const find = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${find("year")}-${find("month")}-${find("day")}`;
}
