/**
 * A small RFC 4180 reader for CSV and TSV (bulk intake spec §3.2).
 *
 * Quoted fields, doubled quotes inside them, embedded delimiters and newlines,
 * CRLF or LF line ends, and a UTF-8 byte-order mark. No dependency, no I/O:
 * every function here is pure, so the review page can preview a file in the
 * browser with exactly the parse the server will run.
 *
 * Deliberately forgiving, because the input is whatever a spreadsheet exported:
 * a stray quote in the middle of an unquoted field is kept as text, a quoted
 * field that never closes runs to the end of the text, and ragged rows are
 * padded to the widest row rather than refused.
 */

export type Delimiter = "," | "\t" | ";" | "|";

/** The delimiters a list may use, tab first: pasted spreadsheet cells are TSV. */
export const DELIMITERS: readonly Delimiter[] = ["\t", ",", ";", "|"];

/** The text without a leading UTF-8 byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Every record in `text`, each a list of fields. Blank lines are dropped, and
 * a record whose every field is blank is dropped too — spreadsheets pad an
 * export with them.
 */
export function parseDelimited(text: string, delimiter: Delimiter): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && !fieldStarted && field.trim() === "") {
      // An opening quote, possibly after spaces a spreadsheet left before it.
      field = "";
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === "\r") {
      if (source[i + 1] === "\n") i += 1;
      endRow();
      continue;
    }
    if (char === "\n") {
      endRow();
      continue;
    }
    field += char;
    if (char.trim() !== "") fieldStarted = true;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows.map((cells) => cells.map((cell) => cell.trim()));
}

/**
 * Which delimiter `text` uses, or null when no delimiter splits its lines
 * consistently — a free-form list, not a table.
 *
 * For each candidate, the number of fields in each of the first lines (quotes
 * respected); the candidate wins when at least two lines agree on two or more
 * fields and at least 80% of the lines share that count. Tab is tried first
 * and wins a tie, because a paste from a spreadsheet is TSV and its cells may
 * well contain commas.
 */
export function detectDelimiter(text: string): Delimiter | null {
  const sample = sampleLines(text, 20);
  if (sample.length < 2) {
    // One line: a table only if it is plainly one (a header with no rows yet).
    const [only] = sample;
    if (!only) return null;
    for (const delimiter of DELIMITERS) {
      if ((parseDelimited(only, delimiter)[0]?.length ?? 0) >= 3) return delimiter;
    }
    return null;
  }

  let best: { delimiter: Delimiter; share: number } | null = null;
  for (const delimiter of DELIMITERS) {
    const counts = parseDelimited(sample.join("\n"), delimiter).map((cells) => cells.length);
    const mode = modeOf(counts);
    if (mode < 2) continue;
    const share = counts.filter((count) => count === mode).length / counts.length;
    if (share < 0.8) continue;
    if (!best || share > best.share) best = { delimiter, share };
  }
  return best?.delimiter ?? null;
}

export interface ParsedTable {
  /** The header row, or generated "Column N" names when the table has none. */
  headers: string[];
  /** Whether {@link headers} came from the text. */
  hasHeader: boolean;
  /** The data rows, each padded to `headers.length`. */
  rows: string[][];
  /** The 1-based line each data row starts on in the source, for "row 14". */
  rowNumbers: number[];
  delimiter: Delimiter;
}

/**
 * The table in `text`: its rows, padded to the widest, with the header row
 * split off when `isHeader` says the first row is one.
 */
export function parseTable(
  text: string,
  delimiter: Delimiter,
  isHeader: (cells: string[]) => boolean
): ParsedTable {
  const records = parseDelimited(text, delimiter);
  const width = records.reduce((max, cells) => Math.max(max, cells.length), 0);
  const padded = records.map((cells) => [...cells, ...Array<string>(Math.max(0, width - cells.length)).fill("")]);
  const hasHeader = padded.length > 0 && isHeader(padded[0]);
  const headers = hasHeader
    ? padded[0].map((cell, index) => cell || `Column ${index + 1}`)
    : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const rows = hasHeader ? padded.slice(1) : padded;
  const offset = hasHeader ? 2 : 1;
  return { headers, hasHeader, rows, rowNumbers: rows.map((_, index) => index + offset), delimiter };
}

/** The first `limit` non-blank lines, for sniffing — not a parse. */
function sampleLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  for (const line of stripBom(text).split(/\r\n|\r|\n/)) {
    if (line.trim() === "") continue;
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

function modeOf(values: number[]): number {
  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  let mode = 0;
  let seen = 0;
  for (const [value, count] of tally) {
    if (count > seen || (count === seen && value > mode)) {
      mode = value;
      seen = count;
    }
  }
  return mode;
}
