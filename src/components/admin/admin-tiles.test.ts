import { createTranslator } from "next-intl";
import messages from "../../../messages/en.json";
import { SERIES_DAYS } from "../../lib/data/admin-overview";
import { factGlyph } from "../system/Tile";
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
  // The tone is what the row means when non-zero; the tile draws no glyph on a 0.
  expect(content.facts).toContainEqual({ label: "No photo", value: 0, tone: "warn" });
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
    expect(tileContent("users", { total: 4, admins: 2, blocked: 0 }, t).content.size).toBe("half");
    expect(tileContent("mirror", { state: "connected" }, t).content.size).toBe("half");
    expect(tileContent("projects", { waiting: 0, published: 2 }, t).content.size).toBe("half");
  });

  it("gives Projects a full tile when something is waiting to be published", () => {
    const { content } = tileContent("projects", { waiting: 2, published: 5 }, t);
    expect(content.size).toBe("full");
    expect(content.facts).toContainEqual({ label: "Published", value: 5, tone: undefined });
  });

  it("shows blocked addresses on the People tile, and nothing when there are none", () => {
    expect(tileContent("users", { total: 4, admins: 2, blocked: 1 }, t).content.facts).toContainEqual({
      label: "Blocked addresses",
      value: 1,
      tone: undefined,
    });
    expect(tileContent("users", { total: 4, admins: 2, blocked: 0 }, t).content.facts).toEqual([]);
  });
});

describe("glyphs only where they carry meaning (DESIGN.md §8.5, 2026-09-25)", () => {
  const zeros = {
    intake: { identified: 0, researching: 0, researched: 0, failed: 0, series: series(0) },
    inventory: { total: 2, published: 2, draft: 0, archived: 0, needsAttention: 0, noPhoto: 0, noManual: 0, neverReviewed: 0 },
    refresh: { proposed: 0, running: 0, failed: 0 },
    research: { searchable: 0, total: 0, failed: 0 },
    maintenance: { open: 0, inProgress: 0, urgent: 0, series: series(0) },
    corrections: { open: 0, handled: 0, series: series(0) },
    projects: { waiting: 0, published: 0 },
    users: { total: 1, admins: 1, blocked: 0 },
  };
  const busy = {
    intake: { identified: 2, researching: 3, researched: 8, failed: 1, series: series(2) },
    inventory: { total: 9, published: 6, draft: 2, archived: 1, needsAttention: 5, noPhoto: 3, noManual: 2, neverReviewed: 4 },
    refresh: { proposed: 1, running: 2, failed: 1 },
    research: { searchable: 4, total: 6, failed: 2 },
    maintenance: { open: 5, inProgress: 3, urgent: 2, series: series(1) },
    corrections: { open: 5, handled: 8, series: series(1) },
    projects: { waiting: 1, published: 1 },
    users: { total: 4, admins: 2, blocked: 1 },
  };
  const glyphs = (counts: Record<string, unknown>, extra = {}) =>
    Object.entries(counts).flatMap(([key, c]) =>
      (tileContent(key as never, c as never, t, extra).content.facts ?? []).map((fact) => ({ label: fact.label, glyph: factGlyph(fact) }))
    );

  it("draws no glyph on any row when every count is zero", () => {
    expect(glyphs(zeros, { imports: { ready: 0, mapping: 0, last30: 0 } }).filter(({ glyph }) => glyph !== null)).toEqual([]);
  });

  it("marks only warn, bad and waiting-on-you rows — never in-progress or neutral ones", () => {
    const marked = glyphs(busy, { imports: { ready: 2, mapping: 0, last30: 2 } });
    for (const { glyph } of marked) expect([null, "warn", "bad", "active"]).toContain(glyph);
    expect(Object.fromEntries(marked.map(({ label, glyph }) => [label, glyph]))).toMatchObject({
      Researching: null,
      Running: null,
      "In progress": null,
      Handled: null,
      "Manuals on file": null,
      "Published — in the catalog": null,
      "Drafts and archived": null,
      "No photo": "warn",
      "High or critical": "bad",
      "Research failed": "bad",
      "Identified, not researched": "active",
      "Imported lists waiting for review": "active",
    });
  });
});
