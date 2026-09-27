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
 * **The second argument is `EXPIRE_NOW`, and that is the whole point.** In Next
 * 16 `revalidateTag(tag, profile)` is *stale-while-revalidate*: the handler
 * marks the tag stale immediately but sets its expiry `profile.expire` seconds
 * out, so the next reader is still served the old entry while a refresh runs
 * behind them — and the action does not even mark its own path revalidated, "so
 * that server actions don't pull their own writes". For a publish that is
 * exactly wrong: the student scanning the QR label seconds after a SuperMaker
 * published the tool gets the pre-publish miss, and only the request after
 * theirs is right. `{ expire: 0 }` sets `expired = now`, which is the immediate
 * expiry §3.9's "freshness comes from invalidation" asks for, and it is what
 * tells Next to mark the path revalidated too.
 *
 * It is spelled as a timespan rather than a named profile on purpose: a named
 * profile would have to be the one the *reads* use, and they use
 * `CATALOG_CACHE` (stale 1 h / revalidate 24 h / expire 7 d), not anything from
 * `next.config`. Passing no second argument would expire immediately as well,
 * but Next deprecated that call and warns on every write.
 *
 * `"server-only"`: `next/cache` exists only in the server build, and nothing
 * under `src/lib/data/` may import this — those modules are loaded by
 * `scripts/` under plain Node.
 */

/**
 * Expire on the spot, rather than after a window of serving the old page.
 *
 * `updateTag` would say the same thing, but it throws outside a server action
 * and `/api/admin/revalidate` is a route handler.
 */
const EXPIRE_NOW = { expire: 0 } as const;

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
  revalidateTag(CATALOG_TAG, EXPIRE_NOW);
}

/** Drop the cached project gallery. */
export function invalidateProjects(): void {
  revalidateTag(PROJECTS_TAG, EXPIRE_NOW);
}
