import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import type { SearchParams } from "./inventory-filters";

/**
 * What `/admin/users` is filtered to, and how that survives a link — the
 * roster's counterpart of `inventory-filters.ts`, directive-free for the same
 * reason (the page is a server component, the table a client island).
 * Anything the page does not offer is dropped, never an error.
 */

export const USER_ACCESS = ["active", "banned"] as const;
export type UserAccess = (typeof USER_ACCESS)[number];

export interface UserFilterState {
  query: string;
  role: Role | null;
  access: UserAccess | null;
}

export const NO_USER_FILTERS: UserFilterState = { query: "", role: null, access: null };

export function parseUserFilters(params: SearchParams): UserFilterState {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const role = first(params.role);
  const access = first(params.access);
  return {
    query: first(params.q)?.slice(0, 120) ?? "",
    role: role && (ROLES as readonly string[]).includes(role) ? (role as Role) : null,
    access: access && (USER_ACCESS as readonly string[]).includes(access) ? (access as UserAccess) : null,
  };
}

export function userFiltersToSearchParams(filters: UserFilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.role) params.set("role", filters.role);
  if (filters.access) params.set("access", filters.access);
  return params;
}

export function matchesUserFilters(
  row: { role: Role; banned: boolean },
  filters: Pick<UserFilterState, "role" | "access">
): boolean {
  if (filters.role && row.role !== filters.role) return false;
  if (filters.access && (filters.access === "banned") !== row.banned) return false;
  return true;
}
