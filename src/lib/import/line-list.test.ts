import { classifySource } from "./detect";
import { isPlainList, parseLine, parseLineList } from "./line-list";

describe("parseLine", () => {
  it.each([
    ["3x Prusa MK4", { name: "Prusa MK4", quantity: 3 }],
    ["Form 2 (2)", { name: "Form 2", quantity: 2 }],
    ["Heat gun x2", { name: "Heat gun", quantity: 2 }],
    ["Soldering station - 4 units", { name: "Soldering station", quantity: 4 }],
    ["Bandsaw, qty 1", { name: "Bandsaw", quantity: 1 }],
    ["Drill press SN: DP-4411", { name: "Drill press", serials: ["DP-4411"] }],
    ["Snapmaker A350", { name: "Snapmaker A350" }],
    ["Glowforge Pro https://glowforge.com/pro", { name: "Glowforge Pro", links: ["https://glowforge.com/pro"] }],
  ])("%s", (line, expected) => {
    expect(parseLine(line)).toEqual(expected);
  });
});

describe("parseLineList", () => {
  it("drops bullets and numbering, and a heading becomes the category of what follows", () => {
    const items = parseLineList("3D printers:\n- 2x Form 2\n* Prusa MK4\n\nWood shop:\n1. Bandsaw\n2) Drill press");
    expect(items).toEqual([
      { name: "Form 2", quantity: 2, category: "3D printers", sourceRow: 2 },
      { name: "Prusa MK4", category: "3D printers", sourceRow: 3 },
      { name: "Bandsaw", category: "Wood shop", sourceRow: 6 },
      { name: "Drill press", category: "Wood shop", sourceRow: 7 },
    ]);
  });
});

describe("what a paste is (§3.2)", () => {
  it("a short-line list is a plain list", () => {
    expect(isPlainList("Form 2\nDrill master Heat Gun\n3x Prusa MK4")).toBe(true);
  });

  it("paragraphs are a document", () => {
    const prose =
      "Our makerspace inventory was last reviewed in spring. The laser room holds a Trotec Speedy 400 which was serviced in March and two smaller Glowforge units that students use for engraving and light cutting work.\nThe wood shop has a SawStop cabinet saw.";
    expect(isPlainList(prose)).toBe(false);
    expect(classifySource(prose).format).toBe("document");
  });

  it("spreadsheet cells are a table; a comma list without a header is a list", () => {
    expect(classifySource("Item\tQty\nForm 2\t2").format).toBe("table");
    expect(classifySource("Prusa MK4, 3 units\nForm 2, 2 units").format).toBe("list");
    expect(classifySource("Item,Qty\nForm 2,2").format).toBe("table");
  });

  it("a file's extension wins", () => {
    expect(classifySource("Form 2\nDrill", "inventory.csv")).toEqual({ format: "table", delimiter: "," });
    expect(classifySource("anything", "list.pdf").format).toBe("document");
  });
});
