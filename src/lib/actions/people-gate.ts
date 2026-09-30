import "server-only";

import { AUDIT_WARNING } from "../admin/audit-warning";
import type { AdminActionWarning, AdminGateError } from "../admin/action-result";
import { reconcileSuperAdminFloor } from "../auth/floor-role";
import type { ActionContext } from "./define";

/**
 * The step the People page runs after its gate and before anything else — the
 * one that is that page's alone (`lib/auth/floor-role.ts`).
 *
 * The floor is written onto the caller's own row before any action calls the
 * admin plugin: `can()` honours the floor and the plugin does not, so without
 * this a floor address whose row says `user` reaches the page with every
 * control live and every save failing. It runs after the permission check, so
 * only somebody the app already treats as a director can trigger it, and it is
 * a no-op for everyone whose row already agrees.
 *
 * Moved here verbatim from `app/admin/users/actions.ts`'s `authorize()`. The
 * grant-allowance action never ran it, and still does not.
 */
export async function reconcileFloorAfterGate(
  ctx: ActionContext
): Promise<{ ok: true; warning?: AdminActionWarning } | { ok: false; error: AdminGateError }> {
  let reconciliation;
  try {
    reconciliation = await reconcileSuperAdminFloor(ctx.identity);
  } catch (err) {
    // The write that follows depends on this having landed, so "failed" is the
    // honest answer — better than letting the plugin refuse for a reason the
    // page cannot explain.
    console.error("[admin/users] super-admin floor reconciliation failed", err);
    return { ok: false, error: "failed" };
  }
  // The reconciliation may have promoted this caller — and lifted a ban — with
  // no trail. That rides back as a warning on whatever the action goes on to
  // do, because refusing here would deny a change the database has kept.
  return reconciliation.audited ? { ok: true } : { ok: true, warning: AUDIT_WARNING };
}
