// @vitest-environment node
import {
  BACKOFF_MS,
  POLL_JITTER_MS,
  POLL_MS,
  ROTATE_MS,
  SHIFT_EVERY_MS,
  SHIFT_OFFSETS,
  STALE_AFTER_MS,
  burnInOffset,
  downMachines,
  featuredOrder,
  msUntilLabHour,
  nextPollDelay,
  rotationIndex,
  seededShuffle,
  shortAuthorName,
  staleness,
  type DownCandidate,
  type UnitStatusCount,
} from "./derive";
import { labToday } from "../lab-time";
import type { KioskFeatured } from "./types";

/**
 * The kiosk's pure decisions (kiosk spec §10, unit layer): down-machine
 * grouping, the author's short name, the day's featured order, and the
 * screen's timing at its boundaries.
 */

const tool = (id: string, name = id): DownCandidate => ({ id, slug: id, name, imageSrc: `/tool-images/${id}.png` });
const count = (toolId: string, status: string, n = 1): UnitStatusCount => ({ toolId, status, count: n });

describe("downMachines", () => {
  it("reads one of two units down as '1 of 2', under maintenance", () => {
    const { down } = downMachines([tool("form-4")], [count("form-4", "available"), count("form-4", "under_maintenance")]);
    expect(down).toEqual([
      { toolSlug: "form-4", toolName: "form-4", imageSrc: "/tool-images/form-4.png", unitsDown: 1, unitsTotal: 2, state: "under_maintenance" },
    ]);
  });

  it("leaves retired units out of both counts", () => {
    const { down, unitsInService } = downMachines(
      [tool("trotec")],
      [count("trotec", "retired", 3), count("trotec", "out_of_service"), count("trotec", "available")]
    );
    expect(down[0]).toMatchObject({ unitsDown: 1, unitsTotal: 2, state: "out_of_service" });
    expect(unitsInService).toBe(2);
  });

  it("reads every unit down as down, and says so when the kinds are mixed", () => {
    const { down } = downMachines([tool("cnc")], [count("cnc", "out_of_service"), count("cnc", "under_maintenance")]);
    expect(down[0]).toMatchObject({ unitsDown: 2, unitsTotal: 2, state: "mixed" });
  });

  it("does not read in_use as down", () => {
    const { down, unitsInService } = downMachines([tool("laser")], [count("laser", "in_use", 2), count("laser", "available")]);
    expect(down).toEqual([]);
    expect(unitsInService).toBe(3);
  });

  it("ignores a tool whose only units are retired, and a tool with no units", () => {
    const { down, unitsInService } = downMachines([tool("old"), tool("none")], [count("old", "retired", 2)]);
    expect(down).toEqual([]);
    expect(unitsInService).toBe(0);
  });

  it("puts the tools with the most units down first, then by name", () => {
    const { down } = downMachines(
      [tool("b", "Bandsaw"), tool("a", "Anvil"), tool("c", "CNC")],
      [count("a", "out_of_service"), count("b", "out_of_service"), count("c", "under_maintenance", 3)]
    );
    expect(down.map((d) => d.toolName)).toEqual(["CNC", "Anvil", "Bandsaw"]);
  });

  it("counts only the tools it is given, so a draft's units never reach the screen", () => {
    const { down, unitsInService } = downMachines([tool("published")], [count("draft", "out_of_service"), count("published", "available")]);
    expect(down).toEqual([]);
    expect(unitsInService).toBe(1);
  });
});

describe("shortAuthorName", () => {
  it.each([
    ["Maya Rodriguez", "Maya R."],
    ["  Maya   de la  Cruz ", "Maya C."],
    ["maya rodriguez", "maya R."],
    ["Maya", "Maya"],
    ["Jean-Luc Picard", "Jean-Luc P."],
    ["Zoë Ångström", "Zoë Å."],
    ["李 小龙", "李 小."],
    ["Maya (Rodriguez)", "Maya R."],
  ])("%s → %s", (name, expected) => {
    expect(shortAuthorName(name)).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "maya@cornell.edu", "Maya maya@cornell.edu", "12345"])(
    "shows nothing for %j rather than something that could be an address",
    (name) => {
      expect(shortAuthorName(name)).toBeNull();
    }
  );

  it("never returns more than the first name's first 24 characters and an initial", () => {
    const short = shortAuthorName(`${"A".repeat(40)} Smith`);
    expect(short).toBe(`${"A".repeat(24)} S.`);
  });
});

describe("featuredOrder", () => {
  const tools: KioskFeatured[] = Array.from({ length: 20 }, (_, i) => ({
    kind: "tool",
    slug: `tool-${String(i).padStart(2, "0")}`,
    name: `Tool ${i}`,
    shortDescription: "",
    imageSrc: "",
  }));
  const projects: KioskFeatured[] = Array.from({ length: 6 }, (_, i) => ({
    kind: "project",
    slug: `project-${i}`,
    title: `Project ${i}`,
    coverSrc: "",
    toolNames: [],
    author: null,
  }));
  const slugs = (items: KioskFeatured[]) => items.map((item) => item.slug);

  it("is at most twelve items, at most four of them projects", () => {
    const order = featuredOrder(tools, projects, "2026-10-11");
    expect(order).toHaveLength(12);
    expect(order.filter((item) => item.kind === "project")).toHaveLength(4);
  });

  it("is the same all day, whatever order the rows arrived in", () => {
    const a = featuredOrder(tools, projects, "2026-10-11");
    const b = featuredOrder([...tools].reverse(), [...projects].reverse(), "2026-10-11");
    expect(slugs(b)).toEqual(slugs(a));
  });

  it("changes the next day", () => {
    expect(slugs(featuredOrder(tools, projects, "2026-10-12"))).not.toEqual(slugs(featuredOrder(tools, projects, "2026-10-11")));
  });

  it("follows the lab's date: 21:00 in New York is already the next day in UTC, and still today on the screen", () => {
    vi.stubEnv("LAB_TIMEZONE", "America/New_York");
    const morning = new Date("2026-10-11T13:00:00Z"); // 09:00 EDT, 11 Oct
    const evening = new Date("2026-10-12T01:00:00Z"); // 21:00 EDT, 11 Oct — 12 Oct in UTC
    expect(evening.toISOString().slice(0, 10)).toBe("2026-10-12");
    expect(labToday(evening)).toBe("2026-10-11");
    expect(slugs(featuredOrder(tools, projects, labToday(evening)))).toEqual(slugs(featuredOrder(tools, projects, labToday(morning))));
    vi.unstubAllEnvs();
  });

  it("takes everything when there is little to choose from", () => {
    const order = featuredOrder(tools.slice(0, 2), projects.slice(0, 1), "2026-10-11");
    expect(order).toHaveLength(3);
    expect(new Set(slugs(order))).toEqual(new Set(["tool-00", "tool-01", "project-0"]));
  });

  it("seededShuffle keeps every item and leaves its input alone", () => {
    const input = [1, 2, 3, 4, 5];
    const out = seededShuffle(input, "seed");
    expect([...out].sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("staleness", () => {
  const t0 = Date.UTC(2026, 9, 11, 14, 0, 0);

  it("is fresh just under three minutes, stale at three", () => {
    expect(staleness(t0, t0 + STALE_AFTER_MS - 1, true)).toBe("fresh");
    expect(staleness(t0, t0 + STALE_AFTER_MS, true)).toBe("stale");
  });

  it("is offline whenever the browser says so, however new the data", () => {
    expect(staleness(t0, t0, false)).toBe("offline");
  });
});

describe("nextPollDelay", () => {
  it("polls every minute plus up to ten seconds of jitter while healthy", () => {
    expect(nextPollDelay(0, 0)).toBe(POLL_MS);
    expect(nextPollDelay(0, 0.999_999)).toBeLessThan(POLL_MS + POLL_JITTER_MS);
    expect(nextPollDelay(0, 0.5)).toBe(POLL_MS + POLL_JITTER_MS / 2);
  });

  it("backs off one minute, then two, then five at most", () => {
    expect([1, 2, 3, 4, 10].map((failures) => nextPollDelay(failures))).toEqual([
      BACKOFF_MS[0],
      BACKOFF_MS[1],
      BACKOFF_MS[2],
      BACKOFF_MS[2],
      BACKOFF_MS[2],
    ]);
    expect(BACKOFF_MS).toEqual([60_000, 120_000, 300_000]);
  });
});

describe("burnInOffset", () => {
  it("never moves the layout more than 8 px", () => {
    for (const [x, y] of SHIFT_OFFSETS) {
      expect(Math.abs(x)).toBeLessThanOrEqual(8);
      expect(Math.abs(y)).toBeLessThanOrEqual(8);
    }
  });

  it("holds for five minutes, then moves", () => {
    const start = SHIFT_EVERY_MS * 1000;
    expect(burnInOffset(start)).toEqual(burnInOffset(start + SHIFT_EVERY_MS - 1));
    expect(burnInOffset(start + SHIFT_EVERY_MS)).not.toEqual(burnInOffset(start));
  });
});

describe("rotationIndex", () => {
  it("shows one item for twenty seconds, then the next, wrapping", () => {
    expect(rotationIndex(0, 3)).toBe(0);
    expect(rotationIndex(ROTATE_MS - 1, 3)).toBe(0);
    expect(rotationIndex(ROTATE_MS, 3)).toBe(1);
    expect(rotationIndex(ROTATE_MS * 3, 3)).toBe(0);
    expect(rotationIndex(123, 0)).toBe(0);
  });
});

describe("msUntilLabHour", () => {
  it("counts to the next 04:00 on the lab's clock, not the server's", () => {
    // 21:00 EDT on 11 Oct is 01:00 UTC on 12 Oct; 04:00 EDT is seven hours on.
    const now = Date.parse("2026-10-12T01:00:00Z");
    expect(msUntilLabHour(now, 4, "America/New_York")).toBe(7 * 3_600_000);
  });

  it("waits a whole day when it is exactly the hour, never zero", () => {
    const now = Date.parse("2026-10-12T08:00:00Z"); // 04:00 EDT
    expect(msUntilLabHour(now, 4, "America/New_York")).toBe(86_400_000);
  });

  it("reads an unknown timezone as UTC", () => {
    const now = Date.parse("2026-10-12T03:30:00Z");
    expect(msUntilLabHour(now, 4, "Not/AZone")).toBe(30 * 60_000);
  });
});
