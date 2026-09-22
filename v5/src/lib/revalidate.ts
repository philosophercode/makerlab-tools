import "server-only";

import { revalidateTag } from "next/cache";

/**
 * Cache invalidation, in one place (spec §3.9, Article 4).
 *
 * The catalogue and the gallery are cached for a long time on purpose —
 * freshness comes from invalidation, not from polling — so **something has to
 * invalidate them, and the thing that does must agree with the thing that
 * tagged them.** A tag is a bare string in `cacheTag("catalog")` and in
 * `revalidateTag("catalog")`, and a save that busts `"catalogue"` is a save the
 * catalogue does not show: no error, no failing test, just a stale page and a
 * person insisting they edited it. Naming both ends here is what stops that.
 *
 * `"minutes"` is the profile every cached read uses (`cacheLife("minutes")`),
 * and `revalidateTag` takes it so Next knows which store to expire.
 *
 * `"server-only"`: `next/cache` exists only in the server build, and nothing
 * under `src/lib/data/` may import this — those modules are loaded by
 * `scripts/` under plain Node.
 */

/** Every cached catalogue read — tools, units, resources, their photos. */
export const CATALOG_TAG = "catalog";

/** Every cached project read — the gallery and each project page. */
export const PROJECTS_TAG = "projects";

/** Tags a full refresh has to clear. */
export const ALL_TAGS = [CATALOG_TAG, PROJECTS_TAG] as const;

/**
 * Drop the cached catalogue.
 *
 * Called by **every** inventory write, including the ones whose row is not
 * published: a draft is invisible to the catalogue today and visible the moment
 * somebody publishes it, and a publish that found a stale cache underneath it
 * would show yesterday's row. Invalidation is cheap here and costs one re-read
 * on the next request, which is the right side of that trade for a catalogue
 * edited a few times a week.
 */
export function invalidateCatalog(): void {
  revalidateTag(CATALOG_TAG, "minutes");
}

/** Drop the cached project gallery. */
export function invalidateProjects(): void {
  revalidateTag(PROJECTS_TAG, "minutes");
}
