/**
 * Where the full tool list lives, and how a link reaches it filtered (student
 * home spec 2026-10-07 §5). The home page (`/`) browses by category; the full
 * list with its search and filters is `/tools`.
 *
 * Plain TypeScript with no imports: `next.config.ts` reads it for the
 * redirects that keep old `/?category=…` links working.
 */

export const ALL_TOOLS_PATH = "/tools";

/**
 * The query keys the full list reads (`components/gallery-filters.ts`). A
 * link to `/` carrying any of them is an old link to the list, which lived on
 * the home page until 2026-10-07; `next.config.ts` redirects it to `/tools`
 * with its query string.
 */
export const GALLERY_QUERY_KEYS = ["q", "status", "category", "material", "location", "kind", "view", "sort", "group"] as const;

/** The full list narrowed by the given filters (`{ material: "Plywood" }`). */
export function allToolsHref(filters: Partial<Record<(typeof GALLERY_QUERY_KEYS)[number], string>>): string {
  const query = new URLSearchParams(filters as Record<string, string>).toString();
  return query ? `${ALL_TOOLS_PATH}?${query}` : ALL_TOOLS_PATH;
}

/** The full list filtered to one top-level category. */
export function categoryHref(category: string): string {
  return allToolsHref({ category });
}
