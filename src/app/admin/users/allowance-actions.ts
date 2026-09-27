"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { AUDIT_WARNING, record } from "../../../lib/admin/audit-warning";
import { can } from "../../../lib/auth/permissions";
import { grantResearchAllowance } from "../../../lib/data/research-allowances";
import { findUserById } from "../../../lib/data/users";
import { ALLOWANCE_PERMISSION } from "../../../lib/import/access";
import { SETUP_ALLOWANCE_MAX_DAYS, SETUP_ALLOWANCE_MAX_ITEMS } from "../../../lib/import/limits";
import { ADMIN_USERS_PATH } from "./action-result";
import type { GrantAllowanceResult } from "./allowance-result";

/**
 * **Grant a setup allowance** (bulk intake spec §4.2, §8): extra research
 * items for a while, on top of the daily 100 — "+400 for 7 days to whoever is
 * loading the inventory".
 *
 * `users.manage` (a super admin), checked here: a server action is reachable
 * without the page. The person must exist and be able to add equipment
 * (`tools.add`) — an allowance for somebody who cannot research is a number
 * that means nothing. Bounded at {@link SETUP_ALLOWANCE_MAX_ITEMS} items and
 * {@link SETUP_ALLOWANCE_MAX_DAYS} days. Every grant is audited
 * (`allowance.granted`); a lost audit event is a warning on the success, as on
 * every admin surface.
 */

const input = z.strictObject({
  userId: z.string().min(1).max(200),
  extraItems: z.number().int().min(1).max(SETUP_ALLOWANCE_MAX_ITEMS),
  days: z.number().int().min(1).max(SETUP_ALLOWANCE_MAX_DAYS),
});

export async function grantSetupAllowance(raw: unknown): Promise<GrantAllowanceResult> {
  const gate = await authorizeAdminAction(ALLOWANCE_PERMISSION);
  if (!gate.ok) return gate;
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "invalid_field" };
  const actorId = gate.identity.userId;
  if (!actorId) return { ok: false, error: "not_signed_in" };

  try {
    const target = await findUserById(parsed.data.userId);
    if (!target) return { ok: false, error: "unknown_user" };
    if (target.banned || !can({ role: target.role }, "tools.add")) return { ok: false, error: "cannot_research" };

    const grant = await grantResearchAllowance({
      userId: target.id,
      extraItems: parsed.data.extraItems,
      days: parsed.data.days,
      grantedBy: actorId,
    });
    const recorded = await record(
      {
        actorUserId: actorId,
        action: "allowance.granted",
        subjectType: "user",
        subjectId: target.id,
        detail: { extraItems: grant.extraItems, days: parsed.data.days, expiresAt: grant.expiresAt.toISOString() },
      },
      "admin/users"
    );
    revalidatePath(ADMIN_USERS_PATH);
    return {
      ok: true,
      expiresAt: grant.expiresAt.toISOString(),
      ...(recorded ? {} : { warning: AUDIT_WARNING }),
    };
  } catch (err) {
    console.error("[admin/users] could not grant a setup allowance", err);
    return { ok: false, error: "failed" };
  }
}
