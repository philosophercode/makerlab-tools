import { CSV_BOM, csvField, csvRecord, neutraliseFormula, toCsv } from "./csv";

describe("csvField — RFC 4180 quoting", () => {
  it("leaves a plain value bare", () => {
    expect(csvField("Form 4")).toBe("Form 4");
  });

  it("quotes a value holding a comma", () => {
    expect(csvField("Resin, clear")).toBe('"Resin, clear"');
  });

  it("quotes a value holding a quote, and doubles the quote", () => {
    expect(csvField('The 12" bandsaw')).toBe('"The 12"" bandsaw"');
  });

  it("quotes a value holding a line break, LF or CRLF, and keeps the break", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
    expect(csvField("line one\r\nline two")).toBe('"line one\r\nline two"');
  });

  it("keeps unicode as it is", () => {
    expect(csvField("Pérez · 3D プリンター ✓")).toBe("Pérez · 3D プリンター ✓");
  });

  it("writes null and undefined as an empty cell, numbers and booleans as text", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(3)).toBe("3");
    expect(csvField(false)).toBe("false");
  });
});

describe("formula injection", () => {
  it.each(["=1+1", "+1", "-1", "@SUM(A1)", "\tcmd", "\rcmd"])("prefixes %j with a single quote", (value) => {
    expect(neutraliseFormula(value)).toBe(`'${value}`);
  });

  it("leaves text that only contains those characters later alone", () => {
    expect(neutraliseFormula("a=b")).toBe("a=b");
    expect(neutraliseFormula("Laser - CO2")).toBe("Laser - CO2");
    expect(neutraliseFormula("")).toBe("");
  });

  it("defuses before quoting, so a quoted formula is still defused", () => {
    expect(csvField('=HYPERLINK("http://evil.test","click")')).toBe(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
  });

  it("defuses a leading CR and then quotes it", () => {
    expect(csvField("\r=1")).toBe(`"'\r=1"`);
  });
});

describe("toCsv", () => {
  it("starts with a BOM, ends every record with CRLF, header first", () => {
    const csv = toCsv(["Name", "Notes"], [
      ["Form 4", "Resin, clear"],
      ["Speedy 400", null],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('Name,Notes\r\nForm 4,"Resin, clear"\r\nSpeedy 400,\r\n');
  });

  it("encodes to UTF-8 with the EF BB BF mark Excel looks for", () => {
    const bytes = new TextEncoder().encode(toCsv(["Name"], [["é"]]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("writes a header-only file for no rows", () => {
    expect(toCsv(["A", "B"], [])).toBe(`${CSV_BOM}A,B\r\n`);
  });

  it("round-trips through a strict RFC 4180 reader", () => {
    const rows = [["a,b", 'say "hi"', "two\nlines", "=cmd", "ü"]];
    const csv = toCsv(["1", "2", "3", "4", "5"], rows);
    expect(parseCsv(csv.slice(1))).toEqual([["1", "2", "3", "4", "5"], ["a,b", 'say "hi"', "two\nlines", "'=cmd", "ü"]]);
  });

  it("csvRecord joins fields with commas", () => {
    expect(csvRecord(["a", 1, null, "b,c"])).toBe('a,1,,"b,c"');
  });
});

/** A minimal RFC 4180 reader, so the round trip is checked by something other than the writer. */
function parseCsv(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      record.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      i += 1;
    } else field += c;
  }
  return records;
}
