/**
 * The value report as CSV (usage insight spec amendment "Value report"): one
 * row per number, this period beside the previous one, so a director can paste
 * it into a budget sheet. The rows are built by the page with its translated
 * labels; this module only quotes. Pure.
 */

export interface CsvRow {
  section: string;
  metric: string;
  current: string | number | null;
  previous?: string | number | null;
  note?: string;
}

/** RFC 4180 quoting, and a leading `'` on anything a spreadsheet would run as a formula. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: [string, string, string, string, string], rows: CsvRow[]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push([row.section, row.metric, row.current, row.previous ?? null, row.note ?? ""].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** `makerlab-ai-value-report-fall-2026.csv` — lower case, hyphens, nothing a filesystem minds. */
export function csvFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "value-report"}.csv`;
}
