/**
 * Which nightly backups to keep (ops hardening spec amendment 2026-09-27
 * "Tiered retention"). Replaces the flat 30-day window.
 *
 * A flat window has one bad property: the oldest copy is always a month old,
 * so damage nobody notices for five weeks is unrecoverable. Tiers keep the
 * store small and still reach back three years:
 *
 * | Age (UTC days before `now`)   | Keep                                  |
 * |-------------------------------|---------------------------------------|
 * | under 7 days                  | every day                             |
 * | 7 days to 1 calendar month    | the newest of each ISO week           |
 * | 1 month to 1 year             | the newest of each calendar month     |
 * | 1 year to 3 years             | the newest of each calendar quarter   |
 * | older                         | nothing                               |
 *
 * Two backups on the same UTC day keep only the newer, in every tier.
 *
 * Each tier looks only at the backups whose age puts them in it, and keeps the
 * newest per bucket. Run daily over what the previous run kept, that converges
 * on exactly one copy per week, month and quarter: as a newer member of a
 * bucket ages into the tier it replaces the one kept yesterday, and no bucket
 * that ever had a backup is left empty.
 *
 * Pure — no clock, no store — so every boundary is testable. `backup.ts` maps
 * blob pathnames to {@link BackupStamp}s and deletes what this says to prune.
 */

export interface BackupStamp {
  /** Opaque identifier, returned as-is (a blob pathname in practice). */
  key: string;
  at: Date;
}

type Tier = "daily" | "weekly" | "monthly" | "quarterly";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_DAYS = 7;

/** The keys to keep, in the order given. */
export function backupsToKeep(backups: readonly BackupStamp[], now: Date): Set<string> {
  const today = utcDay(now);
  const cutoffs = {
    weekly: addUtcMonths(today, -1),
    monthly: addUtcMonths(today, -12),
    quarterly: addUtcMonths(today, -36),
  };

  // Newest backup per (tier, bucket). A tie on the instant keeps the key that
  // sorts last, so the answer does not depend on input order.
  const newest = new Map<string, BackupStamp>();
  const unplaced: string[] = [];
  for (const backup of backups) {
    // An unreadable date is kept, never guessed at: the same rule as a
    // pathname the prune does not recognise.
    if (Number.isNaN(backup.at.getTime())) {
      unplaced.push(backup.key);
      continue;
    }
    const tier = tierOf(utcDay(backup.at), today, cutoffs);
    if (!tier) continue;
    const bucket = `${tier}:${bucketOf(tier, backup.at)}`;
    const held = newest.get(bucket);
    if (!held || isNewer(backup, held)) newest.set(bucket, backup);
  }
  return new Set([...unplaced, ...[...newest.values()].map((backup) => backup.key)]);
}

/** The keys to delete: everything {@link backupsToKeep} does not keep, in the order given. */
export function backupsToPrune(backups: readonly BackupStamp[], now: Date): string[] {
  const keep = backupsToKeep(backups, now);
  return backups.filter((backup) => !keep.has(backup.key)).map((backup) => backup.key);
}

function tierOf(
  day: number,
  today: number,
  cutoffs: { weekly: number; monthly: number; quarterly: number }
): Tier | null {
  // A date after today (clock skew, a hand-named file) is treated as today's:
  // a retention step never deletes something it cannot place.
  if ((today - day) / DAY_MS < DAILY_DAYS) return "daily";
  if (day >= cutoffs.weekly) return "weekly";
  if (day >= cutoffs.monthly) return "monthly";
  if (day >= cutoffs.quarterly) return "quarterly";
  return null;
}

function bucketOf(tier: Tier, at: Date): string {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  switch (tier) {
    case "daily":
      return at.toISOString().slice(0, 10);
    case "weekly":
      return isoWeek(at);
    case "monthly":
      return `${year}-${month + 1}`;
    case "quarterly":
      return `${year}-Q${Math.floor(month / 3) + 1}`;
  }
}

function isNewer(a: BackupStamp, b: BackupStamp): boolean {
  const diff = a.at.getTime() - b.at.getTime();
  return diff !== 0 ? diff > 0 : a.key > b.key;
}

/** Midnight UTC of the day `at` falls on, in epoch milliseconds. */
function utcDay(at: Date): number {
  return Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}

/**
 * `day` moved by whole calendar months, clamped to the target month's last
 * day — one month before 31 March is 28 (or 29) February, not 3 March.
 */
function addUtcMonths(day: number, months: number): number {
  const date = new Date(day);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay));
}

/** ISO 8601 week, as `YYYY-Www` of its ISO year (UTC). */
function isoWeek(at: Date): string {
  const date = new Date(utcDay(at));
  // Thursday of this week decides the ISO year.
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const week = Math.ceil(((date.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
