import { recordAuditEvent, type NewAuditEvent } from "../data/audit";
import type { AdminActionWarning } from "./action-result";

/**
 * Recording a change that has already happened (spec §4.11, Article 4).
 *
 * **The order is not negotiable and neither is the shape.** Every caller writes
 * the audit event *after* the change it describes has committed, and
 * `recordAuditEvent` throws on any database failure. The two are separate
 * statements — the plugin's `setRole` commits on its own, and a tool publish
 * commits before its event is written — so a transient failure between them is
 * an ordinary outcome rather than an exotic one, and there is no transaction
 * spanning them to roll back.
 *
 * Letting the throw propagate would reach the island as a rejected action, and
 * every island answers a rejection by restoring the previous value: the page
 * would show the old state over a database holding the new one. Swallowing it
 * silently would leave a gap in the trail nobody was told about.
 *
 * So the failure becomes a `warning` on a successful result. The row changed,
 * the page says so, and it also says the change was not recorded. The console
 * line is the operator's copy — it is the only place the event now exists.
 *
 * Phase 4 wrote this pair inside `app/admin/users/actions.ts`; it lives here
 * because Phase 5's writes must reuse the channel rather than invent a second
 * one that answers `{ ok: false }` for a write that landed.
 */

/** The one warning these helpers raise. Named so no caller can misspell it. */
export const AUDIT_WARNING: AdminActionWarning = "audit_unavailable";

/**
 * Write the audit event, and say whether it landed. Never rejects.
 *
 * `where` names the surface for the console line, because the event itself is
 * about to exist nowhere else.
 */
export async function record(event: NewAuditEvent, where: string): Promise<boolean> {
  try {
    await recordAuditEvent(event);
    return true;
  } catch (err) {
    console.error(`[${where}] audit write failed after the change landed`, err);
    return false;
  }
}

/**
 * The warning half of a successful result, or nothing.
 *
 * More than one audit write can go missing on one action — a gate's own
 * reconciliation before the action ran, and the action's own — and there is one
 * warning for all of them, because the admin's question is the same either way:
 * *did the trail record this?* Spread into the result (`...warn(…)`) so a
 * success with no gap carries no `warning` key at all.
 */
export function warn(
  gateWarning: AdminActionWarning | undefined,
  recorded = true
): { warning?: AdminActionWarning } {
  const warning = gateWarning ?? (recorded ? undefined : AUDIT_WARNING);
  return warning ? { warning } : {};
}
