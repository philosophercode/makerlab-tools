import { mapConcurrent, parseRefreshArgs } from "./args";

describe("parseRefreshArgs", () => {
  it("defaults to a dry run over every tool that needs it", () => {
    expect(parseRefreshArgs([])).toEqual({ apply: false, limit: null, ids: null, general: false, force: false, concurrency: 3, rounds: 2, out: null });
  });

  it("reads every flag, inline values included", () => {
    expect(parseRefreshArgs(["--apply", "--limit", "5", "--ids=form-4,trotec", "--general", "--force", "--concurrency=2", "--rounds", "1", "--out", "r.json"])).toEqual({
      apply: true,
      limit: 5,
      ids: ["form-4", "trotec"],
      general: true,
      force: true,
      concurrency: 2,
      rounds: 1,
      out: "r.json",
    });
    expect(parseRefreshArgs(["--general", "--limit", "0"]).limit).toBe(0);
  });

  it("refuses what it cannot honour", () => {
    expect(() => parseRefreshArgs(["--dry-run", "--apply"])).toThrow(/cannot both/);
    expect(() => parseRefreshArgs(["--rounds", "3"])).toThrow(/0 to 2/);
    expect(() => parseRefreshArgs(["--limit"])).toThrow(/needs a value/);
    expect(() => parseRefreshArgs(["--ids", ","])).toThrow(/at least one/);
    expect(() => parseRefreshArgs(["--wat"])).toThrow(/Unknown argument/);
  });
});

describe("mapConcurrent", () => {
  it("keeps input order and never runs more than asked at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapConcurrent([30, 5, 20, 1, 10], 2, async (ms, i) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
});
