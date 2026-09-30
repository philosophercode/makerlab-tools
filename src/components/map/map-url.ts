/**
 * `/map`'s address for a place and a search (map UX pass). Directive-free so
 * the explorer and its tests share it. The place is `?highlight=` (a station
 * tag, a zone id or `unplaced`), the search `?q=`; the whole map with no
 * search is plain `/map`.
 */

export const MAP_UNPLACED = "unplaced";

export function mapPlaceUrl(highlight: string | null, query = ""): string {
  const params = new URLSearchParams();
  if (highlight) params.set("highlight", highlight);
  if (query.trim()) params.set("q", query.trim());
  const qs = params.toString();
  return qs ? `/map?${qs}` : "/map";
}
