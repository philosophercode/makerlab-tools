import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { unitsForViewer } from "../../lib/unit-serials";
import type { MakerLabUnit } from "../catalog-types";
import { UnitsTable } from "./UnitsTable";

/**
 * The tool page's units table as this viewer may see it (data platform spec
 * amendment 2026-10-06): whole serials for staff (`catalog.view_serials`), and
 * the masked last four (`•••• 9831`) for everyone else.
 *
 * A server component read inside its own Suspense boundary, like
 * `SignedInToolLocation`. The page's cached shell holds the public table (the
 * boundary's fallback, built from the catalogue, which carries only the masked
 * endings); only this hole reads the identity, so a student or a visitor is
 * never sent a whole serial, and the shell stays cached for all of them.
 */
export async function UnitsForViewer({ units }: { units: MakerLabUnit[] }) {
  const identity = await resolveIdentityFromHeaders();
  return <UnitsTable units={await unitsForViewer(identity, units)} />;
}
