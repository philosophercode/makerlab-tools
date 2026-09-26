import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import type { SearchParams } from "./inventory-filters";

/**
 * What `/admin/users` is filtered to, and how that survives a link — the
 * roster's counterpart of `inventory-filters.ts`, directive-free for the same
 * reason (the page is a server component, the table a client island).
 * Anything the page does not offer is dropped, never an error — including the
 * old `access=banned` facet, retired with Ban (auth spec amendment 2026-09-25):
 * a removed person is not on the roster at all.
 */

export interface UserFilterState {
  query: string;
  role: Role | null;
}

export const NO_USER_FILTERS: UserFilterState = { query: "", role: null };

export function parseUserFilters(params: SearchParams): UserFilterState {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const role = first(params.role);
  return {
    query: first(params.q)?.slice(0, 120) ?? "",
    role: role && (ROLES as readonly string[]).includes(role) ? (role as Role) : null,
  };
}

export function userFiltersToSearchParams(filters: UserFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.role) params.set("role", filters.role);
  return params;
}

export function matchesUserFilters(row: { role: Role }, filters: Pick<UserFilterState, "role">): boolean {
  if (filters.role && row.role !== filters.role) return false;
  return true;
}
