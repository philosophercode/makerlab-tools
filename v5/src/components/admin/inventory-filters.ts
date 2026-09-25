import type { InventoryRow, ToolState } from "../../lib/data/inventory";

/**
 * What `/admin/inventory` is filtered to, and how that survives a link.
 *
 * A directive-free sibling of `InventoryBoard.tsx`, for the reason
 * `app/admin/users/action-result.ts` is one: the page is a server component and
 * the filter console is a client island, and both need this. Anything exported
 * from a `"use client"` module reaches a server component as a client
 * reference, not as the function it looks like, so the shared vocabulary lives
 * here instead.
 *
 * **The filters live in the URL** so a filtered view can be linked and returned
 * to — "every tool with no manual" is a piece of work somebody hands to
 * somebody else, not a mood the page happens to be in. The page reads them
 * from `searchParams` and the island writes them back with `replaceState`.
 */

/** The values `?state=` accepts — the three a tool can actually be in. */
export const INVENTORY_STATES = ["published", "draft", "archived"] as const;

/**
 * The values `?attention=` accepts. `any` is the one that earns the page: it
 * is "show me everything with something wrong", which is how a review starts.
 */
export const ATTENTION_FILTERS = [
  "any",
  "no_photo",
  "no_manual",
  "open_tickets",
  "never_reviewed",
  "floor_check",
] as const;

export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

export interface InventoryFilterState {
  /** Free text, matched fuzzily by the island — never a database query. */
  query: string;
  state: ToolState | null;
  /** A `categories.name`, matched exactly. */
  category: string | null;
  /** A `locations.room`, matched exactly. */
  location: string | null;
  attention: AttentionFilter | null;
}

export const NO_FILTERS: InventoryFilterState = {
  query: "",
  state: null,
  category: null,
  location: null,
  attention: null,
};

/** What a page's `searchParams` looks like once awaited. */
export type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Read the filters out of a URL, dropping anything this page does not offer.
 *
 * A hand-edited `?state=broken` filters by nothing rather than showing an empty
 * table for a state that does not exist, and a repeated parameter takes its
 * first value — both are inputs from a link somebody pasted, and neither is
 * worth an error page.
 */
export function parseInventoryFilters(params: SearchParams): InventoryFilterState {
  return {
    query: first(params.q)?.slice(0, 120) ?? "",
    state: oneOf(INVENTORY_STATES, first(params.state)),
    category: first(params.category) || null,
    location: first(params.location) || null,
    attention: oneOf(ATTENTION_FILTERS, first(params.attention)),
  };
}

/** The filters as a query string — empty ones are left out, not sent blank. */
export function toSearchParams(filters: InventoryFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.state) params.set("state", filters.state);
  if (filters.category) params.set("category", filters.category);
  if (filters.location) params.set("location", filters.location);
  if (filters.attention) params.set("attention", filters.attention);
  return params;
}

/** True when anything is narrowing the table. */
export function hasActiveFilters(filters: InventoryFilterState): boolean {
  return toSearchParams(filters).toString().length > 0;
}

/**
 * Does this row survive the facet filters?
 *
 * Free text is deliberately not here: it is a fuzzy *ranking* over the rows
 * these facets left, and it belongs with the component that owns the order.
 */
export function matchesFilters(row: InventoryRow, filters: InventoryFilterState): boolean {
  if (filters.state && row.state !== filters.state) return false;
  if (filters.category && row.categoryName !== filters.category) return false;
  if (filters.location && row.room !== filters.location) return false;
  if (filters.attention && !matchesAttention(row, filters.attention)) return false;
  return true;
}

function matchesAttention(row: InventoryRow, attention: AttentionFilter): boolean {
  switch (attention) {
    case "any":
      return row.needsAttention;
    case "no_photo":
      return row.attention.noPhoto;
    case "no_manual":
      return row.attention.noManual;
    case "open_tickets":
      return row.attention.openTickets;
    case "never_reviewed":
      return row.attention.neverReviewed;
    case "floor_check":
      return row.attention.floorCheck;
  }
}

/**
 * Ranked, typo-tolerant search keys, weighted by key order the way the
 * gallery's are: the name first, then where the tool sits, then its slug —
 * which is here because a reviewer arriving from a link has a slug in hand.
 */
export const INVENTORY_SEARCH_KEYS: ReadonlyArray<(row: InventoryRow) => string> = [
  (row) => row.name,
  // The official name, with its model or part number (tool display names spec §5.6).
  (row) => row.officialName ?? "",
  (row) => row.categoryName ?? "",
  (row) => row.categoryGroup ?? "",
  (row) => row.room ?? "",
  (row) => row.zone ?? "",
  (row) => row.slug,
];

/**
 * The active filters as one readable phrase, each part translated — what an
 * empty table names (spec §6: an empty state says which filter emptied it,
 * because the reviewer's next move is to drop one of them).
 */
export function describeFilters(
  filters: InventoryFilterState,
  t: (key: string, values?: Record<string, string>) => string
): string {
  const parts: string[] = [];
  const part = (label: string, value: string) => parts.push(t("filterSummaryPart", { label, value }));

  if (filters.query.trim()) part(t("filterSearch"), filters.query.trim());
  if (filters.state) part(t("filterState"), t(`state.${filters.state}`));
  if (filters.category) part(t("filterCategory"), filters.category);
  if (filters.location) part(t("filterLocation"), filters.location);
  if (filters.attention) {
    part(t("filterAttention"), filters.attention === "any" ? t("attentionAny") : t(`flags.${filters.attention}`));
  }
  return parts.join(", ");
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<const T extends readonly string[]>(
  allowed: T,
  value: string | undefined
): T[number] | null {
  return value && (allowed as readonly string[]).includes(value) ? (value as T[number]) : null;
}
