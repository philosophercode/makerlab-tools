import type { FacetOption } from "./FacetFilter";

/**
 * A facet's menu entries: each value with how many rows it would leave.
 *
 * `rows` must already be narrowed by every *other* active filter (and not by
 * this facet), so a count answers "what would I see if I picked this?" —
 * which is what lets the menu disable a value that would empty the table
 * instead of letting somebody find out by picking it.
 */
export function facetOptions<R>(
  rows: readonly R[],
  values: readonly string[],
  matches: (row: R, value: string) => boolean,
  label: (value: string) => string = (value) => value
): FacetOption[] {
  return values.map((value) => ({
    value,
    label: label(value),
    count: rows.reduce((sum, row) => (matches(row, value) ? sum + 1 : sum), 0),
  }));
}

/** The non-empty values, deduplicated and sorted — a facet's value list. */
export function uniqueValues(values: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((a, b) =>
    a.localeCompare(b)
  );
}
