import { looksLikeHeader } from "./columns";
import { detectDelimiter, parseDelimited, parseTable, stripBom } from "./table";

describe("parseDelimited (RFC 4180)", () => {
  it("keeps a quoted comma inside its field", () => {
    expect(parseDelimited('Name,Notes\n"Saw, table",sharp\n', ",")).toEqual([
      ["Name", "Notes"],
      ["Saw, table", "sharp"],
    ]);
  });

  it("reads doubled quotes as one quote", () => {
    expect(parseDelimited('a,"He said ""hi"""', ",")).toEqual([["a", 'He said "hi"']]);
  });

  it("keeps a newline inside a quoted field, and CRLF line ends split records", () => {
    const rows = parseDelimited('Name,Serials\r\n"Form 2","F2-001\nF2-002"\r\nLaser,L-1\r\n', ",");
    expect(rows).toEqual([
      ["Name", "Serials"],
      ["Form 2", "F2-001\nF2-002"],
      ["Laser", "L-1"],
    ]);
  });

  it("strips a UTF-8 byte-order mark", () => {
    expect(stripBom("﻿Name")).toBe("Name");
    expect(parseDelimited("﻿Name,Qty\nDrill,2", ",")[0][0]).toBe("Name");
  });

  it("drops blank lines and all-blank records, and trims cells", () => {
    expect(parseDelimited("a;b\n\n ; \n c ; d \n", ";")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("runs an unclosed quote to the end instead of failing", () => {
    expect(parseDelimited('a,"unclosed\nb', ",")).toEqual([["a", "unclosed\nb"]]);
  });
});

describe("detectDelimiter", () => {
  it("reads pasted spreadsheet cells as TSV, even when cells hold commas", () => {
    expect(detectDelimiter("Item\tQty\nSaw, table\t1\nDrill\t2")).toBe("\t");
  });

  it("finds semicolons (a European CSV export)", () => {
    expect(detectDelimiter("Name;Brand;Qty\nForm 2;Formlabs;2\nDrill;DeWalt;3")).toBe(";");
  });

  it("finds commas when every line agrees", () => {
    expect(detectDelimiter("Name,Qty\nForm 2,2\nDrill,3")).toBe(",");
  });

  it("finds nothing in a free-form list", () => {
    expect(detectDelimiter("Form 2\nHeat gun\nDrill press")).toBeNull();
  });
});

describe("parseTable", () => {
  it("splits off a recognisable header and numbers rows as a spreadsheet does", () => {
    const table = parseTable("Item,Qty\nForm 2,2\nDrill,1", ",", looksLikeHeader);
    expect(table.hasHeader).toBe(true);
    expect(table.headers).toEqual(["Item", "Qty"]);
    expect(table.rows).toEqual([
      ["Form 2", "2"],
      ["Drill", "1"],
    ]);
    expect(table.rowNumbers).toEqual([2, 3]);
  });

  it("numbers the columns when there is no header row", () => {
    const table = parseTable("Form 2\t2\nDrill\t1", "\t", looksLikeHeader);
    expect(table.hasHeader).toBe(false);
    expect(table.headers).toEqual(["Column 1", "Column 2"]);
    expect(table.rows).toHaveLength(2);
    expect(table.rowNumbers).toEqual([1, 2]);
  });

  it("pads ragged rows to the widest", () => {
    const table = parseTable("Name,Brand,Qty\nForm 2\nDrill,DeWalt,2,extra", ",", looksLikeHeader);
    expect(table.headers).toEqual(["Name", "Brand", "Qty", "Column 4"]);
    expect(table.rows[0]).toEqual(["Form 2", "", "", ""]);
  });
});
