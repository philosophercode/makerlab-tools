import { createTranslator } from "next-intl";
import messages from "../../../messages/en.json";
import { SERIES_DAYS } from "../../lib/data/admin-overview";
import { tileContent } from "./admin-tiles";

/**
 * What each home tile says from its counts (UI system spec §8.1): the
 * headline, whether it is waiting work, and — the case that would embarrass
 * us — a loader that failed is "Could not be read", never a 0.
 */

const t = createTranslator({ locale: "en", messages, namespace: "admin" }) as unknown as (
  key: string,
  values?: Record<string, string | number>
) => string;

const series = (last: number) => [...new Array<number>(SERIES_DAYS - 1).fill(0), last];

it("says a failed or missing count could not be read, with nothing implying a number", () => {
  for (const counts of [null, undefined]) {
    const tile = tileContent("maintenance", counts, t);
    expect(tile.unreadable).toBe(true);
    expect(tile.content).toEqual({ value: null, note: "Could not be read", size: "half" });
  }
});

it("makes open tickets waiting work, with urgent ones as a bad fact and a 30-day trend", () => {
  const { content, unreadable } = tileContent("maintenance", { open: 4, inProgress: 1, urgent: 2, series: series(3) }, t);
  expect(unreadable).toBe(false);
  expect(content).toMatchObject({ value: 4, unit: "open tickets", waiting: true });
  expect(content.facts).toContainEqual({ label: "High or critical", value: 2, tone: "bad" });
  expect(content.series?.label).toBe("3 tickets reported in the last 30 days, 3 today");
});

it("does not call the inventory's attention flags waiting work", () => {
  const { content } = tileContent(
    "inventory",
    { total: 5, published: 4, draft: 1, archived: 0, needsAttention: 3, noPhoto: 0, noManual: 2, neverReviewed: 3 },
    t
  );
  expect(content.waiting).toBeFalsy();
  expect(content.facts).toContainEqual({ label: "No photo", value: 0, tone: "ok" });
  expect(content.facts).toContainEqual({ label: "No manual", value: 2, tone: "warn" });
});

it("says the mirror's state in words, not a number", () => {
  expect(tileContent("mirror", { state: "paused" }, t).content).toEqual({ value: null, note: "Paused", size: "half" });
});

it("says what the inventory's numbers count, so they cannot read as a contradiction", () => {
  const { content } = tileContent(
    "inventory",
    { total: 104, published: 100, draft: 3, archived: 1, needsAttention: 103, noPhoto: 5, noManual: 9, neverReviewed: 103 },
    t
  );
  // The header's "100 tools in inventory" is the published count; the tile says
  // its 104 includes drafts and archived ones, and shows the 100 beside it.
  expect(content.unit).toBe("of 104 tools need attention");
  expect(content.facts).toContainEqual({ label: "Published — in the catalog", value: 100, tone: undefined });
  expect(content.facts).toContainEqual({ label: "Drafts and archived", value: 4, tone: undefined });
});

describe("Intake carries the imports (amendment 2026-09-25)", () => {
  const intake = { identified: 1, researching: 0, researched: 2, failed: 0, series: series(1) };

  it("adds the lists waiting for review as a line, and counts them as waiting work", () => {
    const tile = tileContent("intake", intake, t, { imports: { ready: 3, mapping: 1, last30: 4 } });
    expect(tile.content.facts).toContainEqual({ label: "Imported lists waiting for review", value: 3, tone: "active" });
    expect(tile.alsoWaiting).toBe(3);
  });

  it("says nothing about imports to a viewer who may not read them", () => {
    const tile = tileContent("intake", intake, t);
    expect(tile.content.facts?.map((fact) => fact.label)).not.toContain("Imported lists waiting for review");
    expect(tile.alsoWaiting).toBe(0);
  });

  it("says the imports could not be read, never 0, when their loader failed", () => {
    const tile = tileContent("intake", intake, t, { imports: null });
    expect(tile.content.facts).toContainEqual({ label: "Imported lists waiting for review", value: "Could not be read", tone: "bad" });
    expect(tile.alsoWaiting).toBe(0);
  });
});

describe("tile sizes (DESIGN.md §8.2)", () => {
  it("makes People, the mirror and an idle Projects half tiles", () => {
    expect(tileContent("users", { total: 4, admins: 2, banned: 0 }, t).content.size).toBe("half");
    expect(tileContent("mirror", { state: "connected" }, t).content.size).toBe("half");
    expect(tileContent("projects", { waiting: 0, published: 2 }, t).content.size).toBe("half");
  });

  it("gives Projects a full tile when something is waiting to be published", () => {
    const { content } = tileContent("projects", { waiting: 2, published: 5 }, t);
    expect(content.size).toBe("full");
    expect(content.facts).toContainEqual({ label: "Published", value: 5, tone: undefined });
  });

  it("still shows a ban on the People tile", () => {
    expect(tileContent("users", { total: 4, admins: 2, banned: 1 }, t).content.facts).toContainEqual({ label: "Banned", value: 1, tone: "warn" });
  });
});
