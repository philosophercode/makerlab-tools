import { columnMapProblem, fieldForHeader, hasNameColumn, normalizeHeader, suggestColumnMap } from "./columns";

describe("header synonyms (bulk intake spec §3.2)", () => {
  it.each([
    ["Item", "name"],
    ["Tool", "name"],
    ["Equipment", "name"],
    ["Make", "brand"],
    ["Manufacturer", "brand"],
    ["Qty", "quantity"],
    ["Count", "quantity"],
    ["SOP", "labDocs"],
    ["Doc", "labDocs"],
    ["Google Doc", "labDocs"],
    ["Serial #", "serial"],
    ["Model No.", "model"],
    ["Room", "location"],
    ["Manual link", "links"],
    ["Description", "notes"],
  ])("%s → %s", (header, field) => {
    expect(fieldForHeader(header)).toBe(field);
  });

  it("matches a synonym inside a longer header", () => {
    expect(fieldForHeader("Qty on hand")).toBe("quantity");
    expect(fieldForHeader("Equipment (make & model)")).toBe("name");
  });

  it("leaves an unknown header unmatched", () => {
    expect(fieldForHeader("Purchase price")).toBeNull();
    expect(normalizeHeader("  SERIAL_NO. ")).toBe("serial no");
  });
});

describe("suggestColumnMap", () => {
  it("gives each single field to the first header naming it, and gathers notes", () => {
    const map = suggestColumnMap(["Item", "Make", "Tool", "Notes", "Comments", "Qty"]);
    expect(map).toEqual(["name", "brand", null, "notes", "notes", "quantity"]);
  });

  it("with no header, suggests the first wordy column as the name", () => {
    expect(suggestColumnMap(["Column 1", "Column 2"], [["3", "Form 2"]], false)).toEqual([null, "name"]);
  });
});

describe("columnMapProblem", () => {
  it("asks for a name column (§5 unhappy paths)", () => {
    expect(columnMapProblem(["brand", null], 2)).toBe("no_name");
    expect(hasNameColumn(["model"])).toBe(true);
  });

  it("refuses a field twice, except the gathering ones", () => {
    expect(columnMapProblem(["name", "name"], 2)).toBe("duplicate_field");
    expect(columnMapProblem(["name", "links", "links"], 3)).toBeNull();
  });

  it("refuses a map of the wrong width or with unknown fields", () => {
    expect(columnMapProblem(["name"], 2)).toBe("wrong_width");
    expect(columnMapProblem(["name", "price"], 2)).toBe("wrong_width");
  });
});
