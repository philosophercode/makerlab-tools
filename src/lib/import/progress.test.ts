import { importCounts, importIsMoving, importStage, mergeItems, sourceRowStates, splitWaiting } from "./progress";
import type { SourceRowsView } from "./rows";
import type { ImportItemView, ImportView } from "./view";

/**
 * Where an import is, derived from it and its rows (import progress spec §3.1,
 * §6): the stage, the counts behind the bar, and each raw row's state.
 */

function view(over: Partial<ImportView> = {}): ImportView {
  return {
    id: "imp",
    status: "ready",
    format: "table",
    sourceKind: "csv",
    sourceName: "a.csv",
    parseError: null,
    rowCount: 4,
    itemCount: 0,
    duplicateCount: 0,
    progress: {},
    createdByName: null,
    createdByRemoved: false,
    createdAt: "2026-10-27T00:00:00.000Z",
    ...over,
  };
}

function item(id: string, sourceRow: number, status: ImportItemView["status"] = "identified"): ImportItemView {
  return { id, sourceRow, status } as ImportItemView;
}

const SOURCE: SourceRowsView = {
  headers: ["Item"],
  hidden: 0,
  rows: [2, 3, 4, 5].map((row) => ({ row, cells: [`row ${row}`] })),
};

describe("stage and counts", () => {
  it("counts the rows still to write while identifying, and the bar never claims them done", () => {
    const v = view({ status: "identifying", progress: { total: 4, done: 2 } });
    const counts = importCounts(v, [item("a", 2), item("b", 3)]);
    expect(counts).toMatchObject({ total: 4, identified: 2, waiting: 2, toResearch: 2 });
    expect(importStage(v, counts)).toBe("identifying");
    expect(importIsMoving("identifying")).toBe(true);
  });

  it("is researching while anything is queued or running, and done once all sent have finished", () => {
    const v = view();
    expect(importStage(v, importCounts(v, [item("a", 2, "queued"), item("b", 3, "researched")]))).toBe("researching");
    expect(importStage(v, importCounts(v, [item("a", 2, "failed"), item("b", 3, "researched")]))).toBe("done");
    expect(importStage(v, importCounts(v, [item("a", 2), item("b", 3, "researched")]))).toBe("review");
    expect(importIsMoving("review")).toBe(false);
    expect(importIsMoving("done")).toBe(false);
  });

  it("maps the import's own statuses", () => {
    const counts = importCounts(view(), []);
    expect(importStage(view({ status: "mapping" }), counts)).toBe("mapping");
    expect(importStage(view({ status: "parsing" }), counts)).toBe("reading");
    expect(importStage(view({ status: "failed" }), counts)).toBe("failed");
  });
});

describe("each raw row's state", () => {
  it("waits until its item exists, says why it was skipped, and follows research", () => {
    const v = view({ status: "identifying", progress: { total: 3, skipped: [{ sourceRow: 3, reason: "no_name" }] } });
    const rows = sourceRowStates(SOURCE, v, [item("a", 2, "researching")]);
    expect(rows.map((row) => [row.row, row.state])).toEqual([
      [2, "researching"],
      [3, "skipped"],
      [4, "waiting"],
      [5, "waiting"],
    ]);
    expect(rows[1].reason).toBe("no_name");
    const { waiting, handled } = splitWaiting(rows);
    expect(waiting.map((row) => row.row)).toEqual([4, 5]);
    expect(handled.map((row) => row.row)).toEqual([2, 3]);
  });

  it("leaves no row waiting once the rows are written — a heading line is not an item", () => {
    const rows = sourceRowStates(SOURCE, view(), [item("a", 2), item("b", 4), item("c", 5)]);
    expect(rows.find((row) => row.row === 3)?.state).toBe("ignored");
    expect(splitWaiting(rows).waiting).toHaveLength(0);
  });
});

describe("mergeItems", () => {
  it("replaces changed rows by id, adds new ones, and keeps source order", () => {
    const merged = mergeItems([item("a", 2), item("b", 4)], [item("b", 4, "queued"), item("c", 3)]);
    expect(merged.map((row) => [row.id, row.status])).toEqual([
      ["a", "identified"],
      ["c", "identified"],
      ["b", "queued"],
    ]);
  });
});
