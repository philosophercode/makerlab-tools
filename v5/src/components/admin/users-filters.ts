import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import type { SearchParams } from "./inventory-filters";

/**
 * What `/admin/users` is filtered to, and how that survives a link — the
 * roster's counterpart of `inventory-filters.ts`, directive-free for the same
 * reason (the page is a server component, the table a client island).
 * Anything the page does not offer is dropped, never an error — including the
 * old `access=banned` facet, retired with Ban (auth spec amendment 2026-09-25):
 * a removed person is not on the roster at all.
 *
 * Four facets, each a query parameter so "every admin who has not signed in
 * yet" is a link: free text (`q`), `role`, `signed_in` (`yes` / `no`) and
 * `title` — the title as the roster shows it (the custom one, else the role's
 * default label), matched exactly. Sorting is the table's own state and is not
 * in the URL, as on the inventory.
 */

/** The values `?signed_in=` accepts. */
export const SIGNED_IN_FILTERS = ["yes", "no"] as const;
export type SignedInFilter = (typeof SIGNED_IN_FILTERS)[number];

export interface UserFilterState {
  query: string;
  role: Role | null;
  signedIn: SignedInFilter | null;
  /** A shown title ("Supermaker", "Tech Lead"), matched exactly. */
  title: string | null;
}

export const NO_USER_FILTERS: UserFilterState = { query: "", role: null, signedIn: null, title: null };

/** The fields the facets read. `shownTitle` is the title as the Title column displays it. */
export interface FilterableUser {
  role: Role;
  /** The first sign-in as an ISO date, or null for "Not signed in yet". */
  joined: string | null;
  shownTitle: string;
}

export function parseUserFilters(params: SearchParams): UserFilterState {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const role = first(params.role);
  const signedIn = first(params.signed_in);
  const title = first(params.title)?.trim().slice(0, 120);
  return {
    query: first(params.q)?.slice(0, 120) ?? "",
    role: role && (ROLES as readonly string[]).includes(role) ? (role as Role) : null,
    signedIn:
      signedIn && (SIGNED_IN_FILTERS as readonly string[]).includes(signedIn) ? (signedIn as SignedInFilter) : null,
    title: title || null,
  };
}

export function userFiltersToSearchParams(filters: UserFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.role) params.set("role", filters.role);
  if (filters.signedIn) params.set("signed_in", filters.signedIn);
  if (filters.title) params.set("title", filters.title);
  return params;
}

/**
 * Does this row survive the facets? Free text is not here: it is a fuzzy
 * ranking over what the facets left, owned by the roster.
 */
export function matchesUserFilters(
  row: FilterableUser,
  filters: Pick<UserFilterState, "role" | "signedIn" | "title">
): boolean {
  if (filters.role && row.role !== filters.role) return false;
  if (filters.signedIn === "yes" && !row.joined) return false;
  if (filters.signedIn === "no" && row.joined) return false;
  if (filters.title && row.shownTitle !== filters.title) return false;
  return true;
}

/** How many facets (not the search) are narrowing the roster. */
export function activeUserFacets(filters: UserFilterState): number {
  return [filters.role, filters.signedIn, filters.title].filter(Boolean).length;
}
