/**
 * Cache timing — decided here and nowhere else.
 *
 * Next's built-in `"minutes"` profile revalidates about once a minute. For a
 * catalog staff edit a few times a week that is ~1,400 pointless Notion
 * round-trips a day, so the catalog gets its own long-lived profile instead and
 * takes its freshness from *invalidation* rather than polling: the admin
 * revalidate endpoint (`revalidateTag("catalog")`) on a staff action or a Notion
 * automation, with the background refresh as the floor.
 *
 * Both objects are passed straight to `cacheLife(...)`, which also accepts a
 * custom timespan (`{ stale, revalidate, expire }`) as well as a named profile.
 */

/**
 * Catalog reads (`fetchFullCatalog`). Long by design — a Notion outage keeps
 * serving cached data rather than falling back to the mock catalog, which is
 * "fail toward stale, not toward wrong". `/api/health` probes Notion directly so
 * the outage is still visible.
 */
export const CATALOG_CACHE = {
  stale: 60 * 60, //  1 h — a client may serve stale before re-checking
  revalidate: 60 * 60 * 24, // 24 h — background refresh
  expire: 60 * 60 * 24 * 7, //  7 d — hard ceiling
} as const;

/**
 * The `/api/health` Notion probe. Short, but long enough that an uptime monitor
 * polling every minute cannot turn into a Notion request per check.
 */
export const HEALTH_CACHE = {
  stale: 30, // 30 s
  revalidate: 30, // 30 s
  expire: 60, //  1 min
} as const;
