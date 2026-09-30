/**
 * Writing CSV (RFC 4180), with no dependency — the whole of it is quoting.
 *
 * - **Quoted only when it has to be**: a field holding a comma, a double
 *   quote, a CR or an LF is wrapped in double quotes, and a quote inside it is
 *   doubled. Records end in CRLF, the RFC's line break and the one Excel
 *   expects.
 * - **A byte-order mark first** ({@link CSV_BOM}). Without it Excel reads a
 *   UTF-8 file as the system's code page and "Pérez" arrives as "PÃ©rez";
 *   Numbers, Sheets and every CSV parser that knows UTF-8 skip it.
 * - **Formula injection is defused** ({@link neutraliseFormula}). A
 *   spreadsheet runs a cell that begins with `=`, `+`, `-` or `@` (and some
 *   also treat a leading tab or CR as the start of one) as a formula — and a
 *   tool's description is text somebody typed or research copied off the web.
 *   Such a cell is prefixed with a single quote, the OWASP recommendation, so
 *   it opens as the text it is.
 *
 * Pure: no imports, safe on the client and under plain Node.
 */

/** The UTF-8 byte-order mark, as the one character a string carries it in. */
export const CSV_BOM = "﻿";

/** RFC 4180's record separator. */
const CRLF = "\r\n";

/** The characters that make a spreadsheet read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/** A field that has to be quoted: a separator, a quote or a line break inside it. */
const NEEDS_QUOTES = /[",\r\n]/;

/** A value a cell can be given. Null and undefined are an empty cell. */
export type CsvValue = string | number | boolean | null | undefined;

/** `=HYPERLINK(…)` → `'=HYPERLINK(…)`; anything that is not a formula start is returned unchanged. */
export function neutraliseFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** One field: stringified, defused, then quoted when it has to be. */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  const text = neutraliseFormula(String(value));
  return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One record, without its line break. */
export function csvRecord(values: readonly CsvValue[]): string {
  return values.map(csvField).join(",");
}

/**
 * A whole file: the BOM, the header record, then one record per row, each
 * ended with CRLF (the RFC allows the last one to end either way; ending it
 * keeps `cat`-ing two exports together from gluing two records into one).
 */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return CSV_BOM + [headers, ...rows].map((record) => csvRecord(record) + CRLF).join("");
}
