import { fc, RUNS } from "./fc";
import { CSV_BOM, toCsv, type CsvValue } from "@/lib/export/csv";

/**
 * INVARIANT 15 — an exported CSV never carries a live spreadsheet formula,
 * and never loses or shifts a cell.
 *
 * The tools and demo sign-up exports are opened in Excel and Sheets, and their
 * cells hold text strangers wrote (tool names, sign-up answers). For any
 * cells: parsed back with an RFC 4180 reader, the file has exactly the rows
 * and columns it was given; no cell starts with `= + - @`, a tab or a CR; and
 * each cell reads back as its input, with a leading `'` only where it defused one.
 */

/** A strict RFC 4180 reader: quoted fields, doubled quotes, CRLF records. */
function parse(csv: string): string[][] {
  const text = csv.startsWith(CSV_BOM) ? csv.slice(CSV_BOM.length) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const cell: fc.Arbitrary<CsvValue> = fc.oneof(
  fc.string({ maxLength: 30 }),
  fc.constantFrom('=HYPERLINK("http://x","y")', "+1+1", "-2", "@SUM(A1)", "\t=1", "\r=1", 'a,"b"\r\nc', "", "'already"),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined)
);

describe("invariant: CSV exports are inert and lossless", () => {
  it("same shape back, no formula starts, each cell its input", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }).chain((cols) =>
        fc.tuple(
          fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: cols, maxLength: cols }),
          fc.array(fc.array(cell, { minLength: cols, maxLength: cols }), { maxLength: 8 })
        )
      ), ([headers, rows]) => {
        const parsed = parse(toCsv(headers, rows));
        const all = [headers, ...rows];
        expect(parsed.length).toBe(all.length);
        parsed.forEach((line, r) => {
          expect(line.length).toBe(headers.length);
          line.forEach((text, c) => {
            expect(text, `row ${r} col ${c}`).not.toMatch(/^[=+\-@\t\r]/);
            const input = all[r][c];
            const raw = input === null || input === undefined ? "" : String(input);
            expect(text === raw || text === `'${raw}`, `row ${r} col ${c}`).toBe(true);
            if (text !== raw) expect(raw).toMatch(/^[=+\-@\t\r]/);
          });
        });
      }),
      { numRuns: RUNS }
    );
  });
});
