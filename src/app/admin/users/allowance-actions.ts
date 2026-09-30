"use server";

import { PEOPLE_GRANT_ALLOWANCE } from "../../../lib/actions/people-allowance";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type { GrantAllowanceResult } from "./allowance-result";

/**
 * **Grant a setup allowance** (bulk intake spec §4.2, §8) — a one-line wrapper
 * over `people.grant_allowance` (`src/lib/actions/people-allowance.ts`), which
 * holds the rules: `users.manage`, a person who may add equipment, bounded
 * items and days, audited as `allowance.granted`.
 */
export async function grantSetupAllowance(raw: unknown): Promise<GrantAllowanceResult> {
  return performAction(PEOPLE_GRANT_ALLOWANCE, raw, await resolveIdentityFromHeaders(), { surface: "gui" });
}
