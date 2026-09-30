// @vitest-environment node
import { mergeIdentifiedItems, quantityFromName, type IdentifiedItem } from "./identify-items";

/**
 * Many items at once (data platform spec amendment "Many items at once"): the
 * code between the model's `identify_tools` entries and the rows — counts in
 * names, and one object seen twice.
 */

function item(name: string, over: Partial<IdentifiedItem> = {}): IdentifiedItem {
  return { name, attachmentIds: [], ...over };
}

describe("quantityFromName — a typed list's counts", () => {
  it.each([
    ["two Ryobi batteries", "Ryobi batteries", 2],
    ["Two RYOBI ONE+ 18V batteries", "RYOBI ONE+ 18V batteries", 2],
    ["a pair of Weller soldering irons", "Weller soldering irons", 2],
    ["three Prusa MK4", "Prusa MK4", 3],
    ["3x Prusa MK4", "Prusa MK4", 3],
    ["Heat gun x2", "Heat gun", 2],
    ["Fluke 117 multimeter (5)", "Fluke 117 multimeter", 5],
    ["4 Makita cordless drills", "Makita cordless drills", 4],
  ])("%s → %s ×%i", (input, name, quantity) => {
    expect(quantityFromName(input)).toEqual({ name, quantity });
  });

  it.each([
    "Drill press",
    "10 inch table saw",
    "12 V drill",
    "3D printer",
    "Form 4",
    "Bambu Lab X1-Carbon",
    "two",
  ])("leaves %s alone", (input) => {
    expect(quantityFromName(input)).toEqual({ name: input, quantity: null });
  });
});

describe("mergeIdentifiedItems", () => {
  it("keeps one entry per distinct object, in order", () => {
    const { items, merged } = mergeIdentifiedItems([
      item("RYOBI Drill Press", { brand: "RYOBI", attachmentIds: ["p1"] }),
      item("Cricut Maker 3", { brand: "Cricut", attachmentIds: ["p1"] }),
      item("RYOBI ONE+ 18V Battery", { brand: "RYOBI", attachmentIds: ["p1"], quantity: 2 }),
    ]);
    expect(merged).toBe(0);
    expect(items.map((i) => [i.name, i.quantity, i.attachmentIds])).toEqual([
      ["RYOBI Drill Press", 1, ["p1"]],
      ["Cricut Maker 3", 1, ["p1"]],
      ["RYOBI ONE+ 18V Battery", 2, ["p1"]],
    ]);
  });

  it("folds the same object seen in two photos into one item with both photos", () => {
    const { items, merged } = mergeIdentifiedItems([
      item("Cricut Maker 3", { brand: "Cricut", attachmentIds: ["p1"], confidence: "likely", seenIn: "photo 1, right" }),
      item("Maker 3", { brand: "Cricut", attachmentIds: ["p2"], confidence: "sure", seenIn: "photo 2", categoryHint: "Cutting" }),
    ]);
    expect(merged).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "Cricut Maker 3",
      attachmentIds: ["p1", "p2"],
      confidence: "sure",
      seenIn: "photo 1, right; photo 2",
      categoryHint: "Cutting",
      quantity: 1,
    });
  });

  it("keeps the larger count when one object is seen twice", () => {
    const { items } = mergeIdentifiedItems([
      item("two RYOBI batteries", { attachmentIds: ["p1"] }),
      item("RYOBI batteries", { attachmentIds: ["p2"] }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: "RYOBI batteries", quantity: 2, attachmentIds: ["p1", "p2"] });
  });

  it("counts two plates as two units of one tool", () => {
    const { items } = mergeIdentifiedItems([
      item("Prusa MK4", { serialNumber: "SN-1", attachmentIds: ["p1"] }),
      item("Prusa MK4", { serialNumber: "SN-2", attachmentIds: ["p2"] }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ serialNumber: "SN-1", extraSerials: ["SN-2"], quantity: 2 });
  });

  it("takes the plate from the second photo of one object", () => {
    const { items } = mergeIdentifiedItems([
      item("Prusa MK4", { attachmentIds: ["p1"] }),
      item("Prusa MK4", { serialNumber: "SN-9", attachmentIds: ["p2"] }),
    ]);
    expect(items[0]).toMatchObject({ serialNumber: "SN-9", extraSerials: [], quantity: 1 });
  });

  it("never merges unsure items — two unnamed drills may be two drills", () => {
    const { items, merged } = mergeIdentifiedItems([
      item("Cordless drill, brand not visible", { confidence: "unsure", attachmentIds: ["p1"] }),
      item("Cordless drill, brand not visible", { confidence: "unsure", attachmentIds: ["p2"] }),
    ]);
    expect(merged).toBe(0);
    expect(items).toHaveLength(2);
  });

  it("de-duplicates photo ids and caps the quantity", () => {
    const { items } = mergeIdentifiedItems([item("Clamp", { attachmentIds: ["p1", "p1"], quantity: 500 })]);
    expect(items[0].attachmentIds).toEqual(["p1"]);
    expect(items[0].quantity).toBe(50);
  });
});
