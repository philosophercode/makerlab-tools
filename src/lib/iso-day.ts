/**
 * An ISO day (`2026-09-24`) for a date the catalogue stores as a day or a
 * timestamp, or "" when there is none (DESIGN.md §2: dates in data are ISO —
 * locale-neutral and comparable). An unparseable value is returned as written
 * rather than dropped.
 */
export function isoDay(date: string | null | undefined): string {
  if (!date) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toISOString().slice(0, 10);
}
