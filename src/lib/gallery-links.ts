/**
 * Where the tool list lives, and how a link reaches it filtered (student home
 * spec 2026-10-07, amendment "One page: the list at rest"). The list is the
 * home page (`/`): every tool grouped by category, with the search, the
 * category chips and the filters. A filter is a query parameter on `/`.
 *
 * Plain TypeScript with no imports: `next.config.ts` reads it for the
 * redirect that keeps old `/tools?category=…` links working.
 */

/** The list: the home page. */
export const ALL_TOOLS_PATH = "/";

/**
 * Where the list lived from the first student home build until the one-page
 * amendment (2026-10-07). `next.config.ts` redirects it to `/`, query and all,
 * so a bookmarked or shared `/tools?category=Laser` lands on the same view.
 * Tool pages stay at `/tools/<slug>`.
 */
export const FORMER_LIST_PATH = "/tools";

/**
 * The query keys the list reads (`components/gallery-filters.ts`). They are
 * what a link to a filtered list carries, on `/` (and on an old `/tools`
 * link, which the redirect forwards unchanged).
 */
export const GALLERY_QUERY_KEYS = ["q", "status", "category", "material", "location", "kind", "view", "sort", "group"] as const;

/** The list narrowed by the given filters (`{ material: "Plywood" }`). */
export function allToolsHref(filters: Partial<Record<(typeof GALLERY_QUERY_KEYS)[number], string>>): string {
  const query = new URLSearchParams(filters as Record<string, string>).toString();
  return query ? `${ALL_TOOLS_PATH}?${query}` : ALL_TOOLS_PATH;
}

/** The list filtered to one top-level category. */
export function categoryHref(category: string): string {
  return allToolsHref({ category });
}
