import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { canSeeMap } from "../../lib/map/access";
import type { MakerLabTool } from "../catalog-types";
import { ToolLocationMap } from "./ToolLocationMap";

/**
 * The tool page's "Where it is" section, for signed-in people only (map
 * access, PR #98). A server component read inside its own Suspense boundary,
 * so the tool page's cached shell holds no placement at all: a signed-out
 * visitor is sent nothing — no plan, no zone, no station — not a hidden
 * element.
 */
export async function SignedInToolLocation({ tool }: { tool: MakerLabTool }) {
  const identity = await resolveIdentityFromHeaders();
  if (!canSeeMap(identity)) return null;
  return <ToolLocationMap tool={tool} />;
}
