import "server-only";

import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "../admin/action-gate";
import type { AdminActionWarning } from "../admin/action-result";
import { AUDIT_WARNING } from "../admin/audit-warning";
import type { Identity } from "../auth/identity";
import { describeDbError } from "../db/describe-error";
import type { ActionContext, ActionDefinition, ActionResult, ActionSurface } from "./define";

/**
 * `performAction()` — the one path every GUI write takes, and from phase 2 the
 * assistant's confirmation and MCP too (assistant–GUI parity spec §3.3).
 *
 * ```text
 * 1. authorizeAdminAction(permission, identity)  limiter → signed in → permission
 * 2. afterGate?                                  the People page's floor reconciliation
 * 3. input.safeParse                             → the action's own invalid code
 * 4. check?                                      → the action's own refusal codes
 *    beforeRun?  (the surface's)                 → `conflict` when a stored card is stale
 * 5. run                                         → the outcome; a throw is `failed`
 * 6. afterCommit?  (only when something committed)  audit, mirror push → warning at worst
 * 7. revalidate    (only when something committed)  guarded
 * ```
 *
 * The order is the one every admin server action already followed — gate
 * before parse, refusals as values — so moving the actions here changed no
 * code any island renders. The identity is always the surface's to resolve
 * (the cookie for the GUI), never the input's.
 */

export interface PerformOptions<I = unknown> {
  surface: ActionSurface;
  /** Set when a stored proposal is being confirmed (phase 2). */
  proposalId?: string;
  /**
   * A last refusal the surface owes, after `check` and before `run` — the
   * confirm route's "has the subject moved on since the card?" (§3.3 step 4).
   * Runs only once the gate has passed, so nothing is read for a caller who
   * may not act. Answers `"conflict"` or null.
   */
  beforeRun?: (input: I, ctx: ActionContext) => Promise<"conflict" | null>;
}

export async function performAction<I, R extends object, E extends string, C>(
  def: ActionDefinition<I, R, E, C>,
  rawInput: unknown,
  identity: Identity,
  options: PerformOptions<I>
): Promise<ActionResult<R, E>> {
  const gate = await authorizeAdminAction(def.permission, identity);
  if (!gate.ok) return gate;

  const ctx: ActionContext = {
    identity: gate.identity,
    surface: options.surface,
    ...(options.proposalId ? { proposalId: options.proposalId } : {}),
  };
  const label = `action:${def.id}`;

  let gateWarning: AdminActionWarning | undefined;
  if (def.afterGate) {
    const after = await def.afterGate(ctx);
    if (!after.ok) return after;
    gateWarning = after.warning;
  }

  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, error: def.invalidInput };
  const input = parsed.data;

  let outcome;
  try {
    const refusal = def.check ? await def.check(input, ctx) : null;
    if (refusal) return { ok: false, error: refusal };
    // `conflict` is a gate-level code every island already has a sentence for.
    const stale = options.beforeRun ? await options.beforeRun(input, ctx) : null;
    if (stale) return { ok: false, error: stale as E };
    outcome = await def.run(input, ctx);
  } catch (err) {
    // The data layer throws on a database failure because its callers must
    // tell "we declined" from "we do not know". An endpoint may not: a throw
    // reaches the browser as a digest, not a sentence beside the control.
    // The failure's kind, never Drizzle's message: it lists every bound value,
    // and these writes carry people's names and emails (`describeDbError`).
    console.error(`[${label}] the write failed`, describeDbError(err));
    return { ok: false, error: "failed" };
  }
  if (!outcome.ok) return outcome;

  let commitWarning: AdminActionWarning | undefined;
  if (outcome.committed !== undefined) {
    try {
      commitWarning = await def.afterCommit?.(input, outcome.committed, ctx);
    } catch (err) {
      // Every afterCommit in the registry reports rather than throws; one that
      // throws anyway still sits after a committed change, so it is the
      // trail's gap, never the change's failure (queue-write trap #1).
      console.error(`[${label}] after the change landed`, err);
      commitWarning = AUDIT_WARNING;
    }
    const paths = typeof def.revalidate === "function" ? def.revalidate(input) : (def.revalidate ?? []);
    refresh(paths, label);
  }

  // One warning for all of them: the admin's question is the same either way —
  // did the trail record this? The gate's reconciliation is named first, as
  // the People page always did.
  const warning = gateWarning ?? outcome.warning ?? commitWarning;
  return { ok: true, ...outcome.value, ...(warning ? { warning } : {}) } as ActionResult<R, E>;
}

/**
 * Refresh the pages a change touched. The change has landed; a refresh that
 * cannot be scheduled from this caller (a streaming chat response) must not
 * turn it into a failure the caller would report as "nothing changed".
 */
function refresh(paths: string[], label: string): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (err) {
      console.warn(`[${label}] could not refresh ${path}`, err);
    }
  }
}
