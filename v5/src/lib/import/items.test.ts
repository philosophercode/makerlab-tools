import { looksLikeHeader } from "./columns";
import {
  composeName,
  CONSUMABLE_NOTE,
  httpUrl,
  isLabDocUrl,
  normalizeImportItem,
  normalizeImportItems,
  parseQuantity,
  splitSerials,
  tableToRawItems,
} from "./items";
import { parseTable } from "./table";

describe("composeName", () => {
  it("keeps a name that already carries the model", () => {
    expect(composeName("Formlabs Form 2", "Formlabs", "Form 2")).toBe("Formlabs Form 2");
  });
  it("makes one from brand and model when there is no name", () => {
    expect(composeName(null, "Trotec", "Speedy 400")).toBe("Trotec Speedy 400");
  });
  it("adds the model to a generic name", () => {
    expect(composeName("Laser cutter", "Trotec", "Speedy 400")).toBe("Laser cutter Speedy 400");
  });
});

describe("quantity and serials (§2: quantities and serials make units)", () => {
  it("reads the first whole number, else 1", () => {
    expect(parseQuantity("3 units")).toBe(3);
    expect(parseQuantity("x2")).toBe(2);
    expect(parseQuantity("some")).toBe(1);
    expect(parseQuantity(0)).toBe(1);
  });

  it("splits serials one a line or by ; and ,", () => {
    expect(splitSerials("A1\nA2; A3, A1")).toEqual(["A1", "A2", "A3"]);
  });

  it("never has fewer units than serials, and caps at 50", () => {
    const three = normalizeImportItem({ name: "Form 2", quantity: "1", serials: "F1\nF2\nF3" });
    expect(three.ok && three.item.quantity).toBe(3);
    const many = normalizeImportItem({ name: "Clamp", quantity: 400 });
    expect(many.ok && many.item.quantity).toBe(50);
  });
});

describe("links and lab documents (§3.4)", () => {
  it("keeps http(s) links and moves anything else into the notes", () => {
    const result = normalizeImportItem({ name: "Drill", links: "https://dewalt.com/dcd771 see shelf B" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item.links).toEqual([{ url: "https://dewalt.com/dcd771" }]);
    expect(result.item.notes).toContain("see shelf B");
  });

  it("refuses javascript: and relative links", () => {
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl("/manual.pdf")).toBeNull();
    expect(httpUrl("https://example.com/a")).toBe("https://example.com/a");
  });

  it("treats a Google Doc in a links column as a lab document, titled by host", () => {
    const result = normalizeImportItem({ name: "Form 2", links: "https://docs.google.com/document/d/abc/edit" });
    expect(result.ok && result.item.links).toEqual([]);
    expect(result.ok && result.item.labDocs).toEqual([
      { title: "docs.google.com — Lab document", url: "https://docs.google.com/document/d/abc/edit" },
    ]);
    expect(isLabDocUrl("https://drive.google.com/file/d/1")).toBe(true);
    expect(isLabDocUrl("https://formlabs.com/form-2")).toBe(false);
  });

  it("titles a lab document with its row's header, unless the header is generic", () => {
    const sop = normalizeImportItem({ name: "Laser", labDocs: [{ title: "SOP", url: "https://docs.google.com/d/1" }] });
    expect(sop.ok && sop.item.labDocs[0].title).toBe("SOP");
    const generic = normalizeImportItem({ name: "Laser", labDocs: [{ title: "Docs", url: "https://docs.google.com/d/1" }] });
    expect(generic.ok && generic.item.labDocs[0].title).toBe("docs.google.com — Lab document");
  });
});

describe("validation", () => {
  it("skips a row with no name, and says which row", () => {
    const { items, skipped } = normalizeImportItems([{ name: "  ", sourceRow: 4 }, { name: "Drill", sourceRow: 5 }]);
    expect(items.map((item) => item.name)).toEqual(["Drill"]);
    expect(skipped).toEqual([{ sourceRow: 4, reason: "no_name" }]);
  });

  it("marks a likely consumable (§5 mixed lists)", () => {
    const result = normalizeImportItem({ name: "10 boxes of screws" });
    expect(result.ok && result.item.notes).toBe(CONSUMABLE_NOTE);
    const tool = normalizeImportItem({ name: "Drill press" });
    expect(tool.ok && tool.item.notes).toBeNull();
  });
});

describe("tableToRawItems", () => {
  it("reads a confirmed map, gathering notes with their headers and lab docs titled by header", () => {
    const table = parseTable(
      'Item,Make,Qty,Condition,Comments,SOP,Serial #\n"Form 2",Formlabs,2,worn,"back room",https://docs.google.com/d/1,"F1\nF2"',
      ",",
      looksLikeHeader
    );
    const [raw] = tableToRawItems(table, ["name", "brand", "quantity", "notes", "notes", "labDocs", "serial"]);
    const result = normalizeImportItem(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.item).toMatchObject({
      name: "Form 2",
      brand: "Formlabs",
      quantity: 2,
      serials: ["F1", "F2"],
      notes: "Condition: worn\nComments: back room",
      labDocs: [{ title: "SOP", url: "https://docs.google.com/d/1" }],
      sourceRow: 2,
    });
  });
});
