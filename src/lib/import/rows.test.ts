import { readImportRows, sourceRowsView } from "./rows";

/**
 * An import's rows read again from its own text (import progress spec §3.2):
 * the same items in the same order every time, and the raw rows the page
 * shows, numbered as the items' `sourceRow`.
 */

const CSV = "Item,Make,Qty\nForm 2,Formlabs,2\n,Ryobi,1\nHeat gun,Drill master,1\n";

describe("readImportRows", () => {
  it("reads a table through its column map, skipping a nameless row with why", () => {
    const read = readImportRows({ format: "table", sourceText: CSV, sourceName: "a.csv", columnMap: ["name", "brand", "quantity"] });
    expect(read?.rowCount).toBe(3);
    expect(read?.items.map((item) => [item.name, item.sourceRow])).toEqual([
      ["Form 2", 2],
      ["Heat gun", 4],
    ]);
    expect(read?.skipped).toEqual([{ sourceRow: 3, reason: "no_name" }]);
  });

  it("reads the same items in the same order every time — what resuming relies on", () => {
    const source = { format: "table" as const, sourceText: CSV, sourceName: "a.csv", columnMap: ["name", "brand", "quantity"] as const };
    expect(readImportRows({ ...source, columnMap: [...source.columnMap] })).toEqual(readImportRows({ ...source, columnMap: [...source.columnMap] }));
  });

  it("is nothing for a table not yet mapped, or a document", () => {
    expect(readImportRows({ format: "table", sourceText: CSV, sourceName: "a.csv", columnMap: null })).toBeNull();
    expect(readImportRows({ format: "document", sourceText: "prose", sourceName: null, columnMap: null })).toBeNull();
  });

  it("reads a plain list line by line", () => {
    const read = readImportRows({ format: "list", sourceText: "Printers:\n- 2x Prusa MK4\n- Form 2", sourceName: null, columnMap: null });
    expect(read?.items.map((item) => [item.name, item.quantity, item.sourceRow])).toEqual([
      ["Prusa MK4", 2, 2],
      ["Form 2", 1, 3],
    ]);
  });
});

describe("sourceRowsView", () => {
  it("shows a table's header and rows, numbered as the file's lines", () => {
    const view = sourceRowsView({ format: "table", sourceText: CSV, sourceName: "a.csv" });
    expect(view?.headers).toEqual(["Item", "Make", "Qty"]);
    expect(view?.rows.map((row) => row.row)).toEqual([2, 3, 4]);
    expect(view?.rows[0].cells).toEqual(["Form 2", "Formlabs", "2"]);
    expect(view?.hidden).toBe(0);
  });

  it("shows a list's non-empty lines, and nothing for a document", () => {
    expect(sourceRowsView({ format: "list", sourceText: "Drill\n\nSaw", sourceName: null })?.rows).toEqual([
      { row: 1, cells: ["Drill"] },
      { row: 3, cells: ["Saw"] },
    ]);
    expect(sourceRowsView({ format: "document", sourceText: "prose", sourceName: null })).toBeNull();
  });

  it("clips a long cell", () => {
    const long = "x".repeat(400);
    const view = sourceRowsView({ format: "list", sourceText: long, sourceName: null });
    expect(view?.rows[0].cells[0].length).toBe(160);
  });
});
