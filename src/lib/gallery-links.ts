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
export const GALLERY_QUERY_KEYS = ["q", "show", "status", "category", "material", "location", "kind", "view", "sort", "group"] as const;

type ListFilters = Partial<Record<Exclude<(typeof GALLERY_QUERY_KEYS)[number], "show">, string>>;

/**
 * All tools, narrowed by the given filters (`{ material: "Plywood" }`): the
 * home page's All tools view (`show=all`), since the resting Categories view
 * shows tiles, not tools.
 */
export function allToolsHref(filters: ListFilters): string {
  const query = new URLSearchParams({ show: "all", ...filters } as Record<string, string>).toString();
  return `${ALL_TOOLS_PATH}?${query}`;
}

/** One top-level category's tools: the Categories view opened on it, with its way back to the tiles. */
export function categoryHref(category: string): string {
  return `${ALL_TOOLS_PATH}?${new URLSearchParams({ category })}`;
}
