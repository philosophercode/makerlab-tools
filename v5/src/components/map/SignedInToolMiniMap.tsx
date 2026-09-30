import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { canSeeMap } from "../../lib/map/access";
import type { MakerLabTool } from "../catalog-types";
import { ToolMiniMap } from "./ToolMiniMap";

/**
 * The hero's phone mini-map, for signed-in people only — the same rule and
 * the same shape as `SignedInToolLocation`: read inside its own Suspense
 * boundary, so the tool page's cached shell holds no placement and a
 * signed-out visitor is sent nothing. The identity read is React-`cache()`d,
 * so this and "Where it is" share one session lookup.
 */
export async function SignedInToolMiniMap({ tool }: { tool: MakerLabTool }) {
  const identity = await resolveIdentityFromHeaders();
  if (!canSeeMap(identity)) return null;
  return <ToolMiniMap tool={tool} />;
}
