import "server-only";

import { PENDING_APPROVE } from "../actions/intake";
import type { ActionContext } from "../actions/define";
import type { Identity } from "../auth/identity";
import { getPendingTool } from "../data/pending-tools";
import { describeDbError } from "../db/describe-error";
import { ADMIN_ACTION_TIER, rateLimitAsync } from "../rate-limit";
import type { IntakeApproveResult } from "../../app/admin/intake/action-result";
import { withDemoActor } from "./actor";
import { demoAdminReadOnly, isDemoAdmin, isDemoOwned } from "./config";

/**
 * **Approve** for the demo identity (demo admin spec 2026-10-11 §5): the one
 * approval it may make — its own researched item, published, as the owner
 * decided ("an added item is published immediately").
 *
 * The demo holds neither `tools.approve` nor `tools.publish`, so
 * `performAction(PENDING_APPROVE, …)` refuses it at the gate, and must: those
 * grants would reach every pending item and every existing tool's publish,
 * archive and restore. This is the narrow door instead, in the same order as
 * `performAction` — limiter, identity, parse, then the owner check that
 * replaces the permission — and then the definition's own `run` and refresh,
 * so the approval itself, its audit event and its image are exactly the
 * page's. Anything that is not the demo, or not the demo's item, is
 * `not_permitted`.
 */
export async function approveAsDemo(rawInput: unknown, identity: Identity): Promise<IntakeApproveResult> {
  if (!isDemoAdmin(identity)) return { ok: false, error: "not_permitted" };
  // The read-only public demo (amendment 2026-10-22) publishes nothing, not even
  // an item the booth demo left behind.
  if (demoAdminReadOnly()) return { ok: false, error: "not_permitted" };

  const { allowed } = await rateLimitAsync(`admin-action:${identity.rateLimitKey}`, ADMIN_ACTION_TIER);
  if (!allowed) return { ok: false, error: "rate_limited" };

  const parsed = PENDING_APPROVE.input.safeParse({ ...(rawInput as object), publish: true });
  if (!parsed.success) return { ok: false, error: PENDING_APPROVE.invalidInput };
  const input = parsed.data;

  let item;
  try {
    item = await getPendingTool(input.id);
  } catch (err) {
    console.error("[demo-admin] could not read the item to approve", describeDbError(err));
    return { ok: false, error: "failed" };
  }
  // The owner check stands where the permission check would: the demo
  // publishes what the demo added, and nothing else.
  if (!item) return { ok: false, error: "not_found" };
  if (!isDemoOwned(item)) return { ok: false, error: "not_permitted" };

  const actor = await withDemoActor(identity);
  if (!actor.userId) return { ok: false, error: "not_signed_in" };
  const ctx: ActionContext = { identity: actor, surface: "gui" };

  let outcome;
  try {
    outcome = await PENDING_APPROVE.run(input, ctx);
  } catch (err) {
    console.error("[demo-admin] the approval failed", describeDbError(err));
    return { ok: false, error: "failed" };
  }
  if (!outcome.ok) return outcome;

  const paths = typeof PENDING_APPROVE.revalidate === "function" ? PENDING_APPROVE.revalidate(input) : (PENDING_APPROVE.revalidate ?? []);
  if (paths.length > 0) {
    const { revalidatePath } = await import("next/cache");
    for (const path of paths) {
      try {
        revalidatePath(path);
      } catch (err) {
        console.warn(`[demo-admin] could not refresh ${path}`, err);
      }
    }
  }
  return { ok: true, ...outcome.value } as IntakeApproveResult;
}
