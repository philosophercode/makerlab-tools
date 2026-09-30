import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { getCatalogTools } from "../../lib/catalog";
import { canSeeMap } from "../../lib/map/access";
import { STUDIO_101 } from "../../lib/map/studio-101";
import type { MakerLabTool, ProjectToolRef } from "../catalog-types";
import { ProjectWorkMap } from "./ProjectWorkMap";

/**
 * A project page's "Where you'll work", for signed-in people only — the same
 * rule and the same shape as the tool page's `SignedInToolLocation` (map
 * access, PR #98). The page renders it in its own Suspense boundary, so the
 * cached project shell holds no placement; the identity check comes before
 * the catalogue read, so a signed-out response carries no plan, zone or
 * station at all.
 *
 * The project's tool references are resolved against the published
 * catalogue (the cached list the gallery warms); a tool that is no longer
 * published is left out, as the page's "Tools used" badges would 404 anyway.
 */
export async function SignedInProjectWorkMap({ tools }: { tools: readonly ProjectToolRef[] }) {
  if (tools.length === 0) return null;
  const identity = await resolveIdentityFromHeaders();
  if (!canSeeMap(identity)) return null;
  const catalogue = await getCatalogTools();
  const byId = new Map(catalogue.map((tool) => [tool.id, tool] as const));
  const resolved = tools.map((ref) => byId.get(ref.id)).filter((tool): tool is MakerLabTool => Boolean(tool));
  if (resolved.length === 0) return null;
  return <ProjectWorkMap plan={STUDIO_101} tools={resolved} />;
}
