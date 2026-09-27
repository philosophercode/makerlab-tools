// @vitest-environment node
import { backupsToKeep, backupsToPrune, type BackupStamp } from "./backup-retention";

/**
 * The retention tiers, one boundary at a time. Dates are UTC; `now` is a
 * Sunday so ISO weeks are easy to read: 2026-09-20 is the last day of W38.
 */

const NOW = new Date("2026-09-20T07:17:00.000Z");

/** A backup named after its day, stamped at the nightly run's time unless given one. */
function stamp(day: string, time = "07:17:00"): BackupStamp {
  return { key: `${day}T${time}`, at: new Date(`${day}T${time}.000Z`) };
}

function days(from: string, count: number): BackupStamp[] {
  const start = Date.parse(`${from}T07:17:00.000Z`);
  return Array.from({ length: count }, (_, i) =>
    stamp(new Date(start + i * 86_400_000).toISOString().slice(0, 10))
  );
}

function kept(backups: BackupStamp[], now = NOW): string[] {
  const keep = backupsToKeep(backups, now);
  return backups.filter((b) => keep.has(b.key)).map((b) => b.key.slice(0, 10));
}

/** Simulate the nightly job: one new backup a day, pruned after each write. */
function simulate(from: string, nights: number): BackupStamp[] {
  let store: BackupStamp[] = [];
  for (const backup of days(from, nights)) {
    store = [...store, backup];
    const prune = new Set(backupsToPrune(store, backup.at));
    store = store.filter((b) => !prune.has(b.key));
  }
  return store;
}

describe("daily tier — under 7 days", () => {
  it("keeps every backup from today and the six days before", () => {
    const week = days("2026-09-14", 7);
    expect(kept(week)).toEqual(week.map((b) => b.key.slice(0, 10)));
  });

  it("moves the seventh day back out of the daily tier", () => {
    // 2026-09-13 is exactly 7 days old and the only backup of ISO week 37 —
    // it survives as that week's copy, not as a daily.
    const backups = [stamp("2026-09-12"), stamp("2026-09-13"), ...days("2026-09-14", 7)];
    expect(kept(backups)).not.toContain("2026-09-12");
    expect(kept(backups)).toContain("2026-09-13");
  });

  it("counts UTC days, not hours since the run", () => {
    // 6 days and 23 hours ago is still the sixth day back.
    const backups = [stamp("2026-09-14", "08:00:00"), stamp("2026-09-15", "00:00:00")];
    expect(kept(backups, new Date("2026-09-20T07:00:00.000Z"))).toEqual(["2026-09-14", "2026-09-15"]);
  });

  it("keeps a backup dated after now rather than guessing where it belongs", () => {
    expect(kept([stamp("2026-09-25")])).toEqual(["2026-09-25"]);
  });
});

describe("same-day duplicates", () => {
  it("keeps only the newest of two backups on one UTC day", () => {
    const early = stamp("2026-09-19", "07:17:00");
    const late = stamp("2026-09-19", "15:02:00");
    expect(backupsToPrune([early, late], NOW)).toEqual([early.key]);
    expect(backupsToPrune([late, early], NOW)).toEqual([early.key]);
  });

  it("keeps the newest duplicate in older tiers too", () => {
    const early = stamp("2026-03-10", "01:00:00");
    const late = stamp("2026-03-10", "23:00:00");
    expect(backupsToKeep([early, late], NOW)).toEqual(new Set([late.key]));
  });

  it("breaks an exact tie by key, whatever the input order", () => {
    const a = { key: "a", at: new Date("2026-09-19T07:17:00.000Z") };
    const b = { key: "b", at: new Date("2026-09-19T07:17:00.000Z") };
    expect(backupsToKeep([a, b], NOW)).toEqual(new Set(["b"]));
    expect(backupsToKeep([b, a], NOW)).toEqual(new Set(["b"]));
  });
});

describe("weekly tier — 7 days to 1 month", () => {
  it("keeps the newest backup of each ISO week", () => {
    // 2026-08-24 (Mon) … 2026-09-13 (Sun) is W35–W37, every day present.
    const backups = days("2026-08-24", 21);
    expect(kept(backups)).toEqual(["2026-08-30", "2026-09-06", "2026-09-13"]);
  });

  it("keeps the newest backup of a week that has gaps", () => {
    const backups = [stamp("2026-09-01"), stamp("2026-09-03")]; // W36, Tue and Thu
    expect(kept(backups)).toEqual(["2026-09-03"]);
  });

  it("uses the week's newest member in the tier while its tail is still daily", () => {
    // Now is Monday 2026-09-21. W37 (09-07 … 09-13) is all weekly and keeps
    // 09-13; of W38 only 09-14 has aged out of the daily tier, so it is W38's
    // weekly copy for today, and 09-15 … 09-21 are dailies.
    const backups = days("2026-09-07", 15);
    const monday = new Date("2026-09-21T07:17:00.000Z");
    expect(kept(backups, monday)).toEqual(days("2026-09-13", 9).map((b) => b.key.slice(0, 10)));
  });

  it("ends at one calendar month: the same date last month is weekly, the day before is monthly", () => {
    // Cut-off is 2026-08-20. 08-19 (W34) and 08-20 (W34) land in different tiers.
    const backups = [stamp("2026-08-18"), stamp("2026-08-19"), stamp("2026-08-20")];
    // 08-20 is W34's weekly copy; 08-18 and 08-19 are August's monthly
    // candidates, and the newer one is kept.
    expect(kept(backups)).toEqual(["2026-08-19", "2026-08-20"]);
  });

  it("names ISO weeks across a year end", () => {
    // 2027-01-01 (Fri) belongs to 2026-W53; 2027-01-04 (Mon) opens 2027-W01.
    const now = new Date("2027-01-20T07:17:00.000Z");
    const backups = [stamp("2026-12-28"), stamp("2027-01-01"), stamp("2027-01-03"), stamp("2027-01-04")];
    expect(kept(backups, now)).toEqual(["2027-01-03", "2027-01-04"]);
  });
});

describe("monthly tier — 1 month to 1 year", () => {
  it("keeps the newest backup of each calendar month", () => {
    const backups = [stamp("2026-05-01"), stamp("2026-05-31"), stamp("2026-06-15"), stamp("2026-07-02"), stamp("2026-07-20")];
    expect(kept(backups)).toEqual(["2026-05-31", "2026-06-15", "2026-07-20"]);
  });

  it("clamps the month cut-off at a short month", () => {
    // One month before 31 March is 28 February (2027 is not a leap year).
    const now = new Date("2027-03-31T07:17:00.000Z");
    const backups = [stamp("2027-02-27"), stamp("2027-02-28")];
    // 02-28 is weekly; 02-27 is February's monthly copy.
    expect(kept(backups, now)).toEqual(["2027-02-27", "2027-02-28"]);
  });

  it("ends at one year: the same date last year is monthly, the day before is quarterly", () => {
    const backups = [stamp("2025-09-18"), stamp("2025-09-19"), stamp("2025-09-20")];
    // 09-20 is September 2025's monthly copy; 09-18 and 09-19 fall to Q3 2025,
    // which keeps the newer.
    expect(kept(backups)).toEqual(["2025-09-19", "2025-09-20"]);
  });
});

describe("quarterly tier — 1 year to 3 years", () => {
  it("keeps the newest backup of each calendar quarter", () => {
    const backups = [stamp("2024-01-05"), stamp("2024-03-30"), stamp("2024-04-01"), stamp("2024-12-31"), stamp("2025-02-01")];
    expect(kept(backups)).toEqual(["2024-03-30", "2024-04-01", "2024-12-31", "2025-02-01"]);
  });

  it("keeps the backup exactly three years old and deletes the day before", () => {
    const backups = [stamp("2023-09-19"), stamp("2023-09-20")];
    expect(backupsToPrune(backups, NOW)).toEqual(["2023-09-19T07:17:00"]);
  });

  it("deletes everything older than three years", () => {
    expect(backupsToPrune([stamp("2020-01-01"), stamp("2023-01-01")], NOW)).toEqual([
      "2020-01-01T07:17:00",
      "2023-01-01T07:17:00",
    ]);
  });
});

describe("as the nightly job runs it", () => {
  it("converges on 7 dailies, then weeklies, monthlies and quarterlies", () => {
    // Every night for just over three years, pruning after each write.
    const store = simulate("2023-06-01", 3 * 366 + 120);
    const lastDay = store[store.length - 1].key.slice(0, 10);
    const now = new Date(`${lastDay}T07:17:00.000Z`);

    // A second pass over the survivors deletes nothing: the rule is stable.
    expect(backupsToPrune(store, now)).toEqual([]);

    // Nothing older than three years, and a few dozen files at most: 7 dailies,
    // up to 6 weeks, 13 months and 9 quarters touching their tier.
    expect(store[0].at.getTime()).toBeGreaterThanOrEqual(Date.UTC(now.getUTCFullYear() - 3, now.getUTCMonth(), now.getUTCDate()));
    expect(store.length).toBeLessThanOrEqual(7 + 6 + 13 + 9);

    // Every calendar month of the last year still has a copy.
    for (let back = 1; back <= 11; back += 1) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
      expect(store.some((b) => b.key.startsWith(month))).toBe(true);
    }
  });

  it("never empties a bucket that had a backup, across a gap of missed nights", () => {
    const store = simulate("2026-01-01", 30).concat(days("2026-06-01", 10));
    const now = new Date("2026-09-20T07:17:00.000Z");
    const survivors = kept(store, now);
    expect(survivors.some((day) => day.startsWith("2026-01"))).toBe(true);
    expect(survivors.some((day) => day.startsWith("2026-06"))).toBe(true);
  });
});

describe("input handling", () => {
  it("returns nothing to prune for an empty store", () => {
    expect(backupsToPrune([], NOW)).toEqual([]);
  });

  it("keeps a stamp whose date is unreadable rather than pruning it", () => {
    const bad = { key: "bad", at: new Date("not a date") };
    expect(backupsToKeep([bad], NOW).has("bad")).toBe(true);
    expect(backupsToPrune([bad, stamp("2020-01-01")], NOW)).toEqual(["2020-01-01T07:17:00"]);
  });
});
