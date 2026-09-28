import "server-only";

import { z } from "zod";
import { ADMIN_USERS_PATH } from "../../app/admin/users/action-result";
import { record } from "../admin/audit-warning";
import { can } from "../auth/permissions";
import { grantResearchAllowance } from "../data/research-allowances";
import { findUserById } from "../data/users";
import { ALLOWANCE_PERMISSION } from "../import/access";
import { SETUP_ALLOWANCE_MAX_DAYS, SETUP_ALLOWANCE_MAX_ITEMS } from "../import/limits";
import { auditTrail, defineAction } from "./define";

/**
 * **Grant a setup allowance** (spec §4.7 #49; bulk intake spec §4.2, §8):
 * extra research items for a while, on top of the daily 100. Moved verbatim
 * from `app/admin/users/allowance-actions.ts`.
 *
 * `users.manage`, and — unlike the rest of the People page — no floor
 * reconciliation, because this action never ran one. The person must exist and
 * be able to add equipment: an allowance for somebody who cannot research is a
 * number that means nothing. Every grant is audited (`allowance.granted`).
 *
 * **Never the assistant's** (owner decision 2026-09-27): the People page's
 * button only, on every surface's deny list (`define.ts`).
 */

type AllowanceError = "invalid_field" | "unknown_user" | "cannot_research";

export const PEOPLE_GRANT_ALLOWANCE = defineAction<
  { userId: string; extraItems: number; days: number },
  { expiresAt: string },
  AllowanceError,
  { extraItems: number; expiresAt: Date }
>({
  id: "people.grant_allowance",
  toolName: "grant_research_allowance",
  description: `Grant one person extra research items (1–${SETUP_ALLOWANCE_MAX_ITEMS}) for a number of days (1–${SETUP_ALLOWANCE_MAX_DAYS}), on top of the daily allowance.`,
  permission: ALLOWANCE_PERMISSION,
  risk: "people",
  assistant: "never",
  neverReason: "Research allowances spend the lab's money and are granted on the People page only (owner decision 2026-09-27)",
  input: z.strictObject({
    userId: z.string().min(1).max(200),
    extraItems: z.number().int().min(1).max(SETUP_ALLOWANCE_MAX_ITEMS),
    days: z.number().int().min(1).max(SETUP_ALLOWANCE_MAX_DAYS),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "user", id: input.userId }),
  check: async (input) => {
    const target = await findUserById(input.userId);
    if (!target) return "unknown_user";
    if (target.banned || !can({ role: target.role }, "tools.add")) return "cannot_research";
    return null;
  },
  run: async (input, ctx) => {
    const actorId = ctx.identity.userId;
    if (!actorId) return { ok: false, error: "not_signed_in" };
    const target = await findUserById(input.userId);
    if (!target) return { ok: false, error: "unknown_user" };
    if (target.banned || !can({ role: target.role }, "tools.add")) return { ok: false, error: "cannot_research" };

    const grant = await grantResearchAllowance({
      userId: target.id,
      extraItems: input.extraItems,
      days: input.days,
      grantedBy: actorId,
    });
    return {
      ok: true,
      value: { expiresAt: grant.expiresAt.toISOString() },
      committed: { extraItems: grant.extraItems, expiresAt: grant.expiresAt },
    };
  },
  afterCommit: async (input, grant, ctx) => {
    const recorded = await record(
      {
        ...auditTrail(ctx),
        actorUserId: ctx.identity.userId,
        action: "allowance.granted",
        subjectType: "user",
        subjectId: input.userId,
        detail: { extraItems: grant.extraItems, days: input.days, expiresAt: grant.expiresAt.toISOString() },
      },
      "admin/users"
    );
    return recorded ? undefined : "audit_unavailable";
  },
  revalidate: [ADMIN_USERS_PATH],
});
