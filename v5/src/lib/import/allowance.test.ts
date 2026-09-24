import { chunkIds, effectiveDailyLimit, remainingAllowance, suggestLedgerRows } from "./allowance";

const NOW = new Date("2026-09-24T12:00:00Z");

describe("the setup allowance (bulk intake spec §4.2)", () => {
  it("adds every running grant to the daily base", () => {
    const grants = [
      { extraItems: 400, expiresAt: new Date("2026-09-30T00:00:00Z") },
      { extraItems: 50, expiresAt: "2026-09-25T00:00:00Z" },
    ];
    expect(effectiveDailyLimit(100, grants, NOW)).toBe(550);
  });

  it("ignores an expired or malformed grant", () => {
    const grants = [
      { extraItems: 400, expiresAt: new Date("2026-09-24T11:59:59Z") },
      { extraItems: -5, expiresAt: new Date("2026-10-01T00:00:00Z") },
      { extraItems: 10, expiresAt: "not a date" },
    ];
    expect(effectiveDailyLimit(100, grants, NOW)).toBe(100);
  });

  it("never goes below zero remaining", () => {
    expect(remainingAllowance(100, 63)).toBe(37);
    expect(remainingAllowance(100, 140)).toBe(0);
  });
});

describe("Suggest names costs a quarter of an item each (§3.3)", () => {
  it.each([
    [0, 0],
    [1, 1],
    [4, 1],
    [5, 2],
    [100, 25],
  ])("%i suggestions cost %i ledger rows", (items, rows) => {
    expect(suggestLedgerRows(items)).toBe(rows);
  });
});

describe("chunkIds", () => {
  it("keeps order and puts the remainder last", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `id-${i}`);
    const chunks = chunkIds(ids, 25);
    expect(chunks.map((chunk) => chunk.length)).toEqual([25, 25, 10]);
    expect(chunks.flat()).toEqual(ids);
  });
});
