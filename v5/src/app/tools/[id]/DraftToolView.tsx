import { notFound } from "next/navigation";
import { DetailShell } from "../../../components/DetailShell";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { can } from "../../../lib/auth/permissions";
import { findToolByIdOrSlug } from "../../../lib/data/catalog";

/**
 * A draft tool at its own slug, for the people allowed to see one
 * (spec §5.3(b)).
 *
 * **Everyone else gets the 404 page**, and gets it for both reasons at once: a
 * slug nobody owns and a draft somebody may not see are the same refusal here.
 * A different-looking message for the second would confirm that the draft
 * exists, which is the thing `catalog.view_drafts` is withholding.
 *
 * **It is a dynamic hole inside its own Suspense boundary, on purpose.**
 * `getCatalogTool` is `"use cache"` and published-only, and it cannot take an
 * identity — a cached read that varied by caller would serve one person's
 * answer to the next. So the published page keeps its fast path untouched, and
 * only the *miss* reads headers, inside a boundary. Doing it any higher would
 * mark the whole tool page dynamic under `cacheComponents` and lose the cache
 * for every visitor. `QrArrivalNotice` is the same shape above it.
 *
 * No projects are loaded: "Built with this" lists published projects, and a
 * tool that is not in the catalogue has none worth a second query.
 */

export async function DraftToolView({ idOrSlug }: { idOrSlug: string }) {
  const identity = await resolveIdentityFromHeaders();
  if (!can(identity, "catalog.view_drafts")) notFound();

  // Uncached and draft-inclusive — the opposite of `getCatalogTool` in both
  // respects, which is why it is a separate read rather than a flag on that one.
  const tool = await findToolByIdOrSlug(idOrSlug, { includeDrafts: true });
  if (!tool) notFound();

  return <DetailShell tool={tool} />;
}
