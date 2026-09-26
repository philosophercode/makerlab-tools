import "server-only";

import { revalidatePath } from "next/cache";
import type { Identity } from "../auth/identity";
import type { Permission } from "../auth/permissions";
import { authorizeAdminAction } from "./action-gate";
import type { AdminActionWarning, AdminGateError } from "./action-result";

/**
 * The preamble every queue write shares (spec §5.6, §8).
 *
 * `/admin/maintenance`, `/admin/corrections` and `/admin/projects` are three
 * pages doing one shape of work: gate on the permission *this* surface needs,
 * apply one small change to one row, refresh the page it came from. This module
 * owns that shape so each surface's `actions.ts` holds nothing but the write it
 * is named after and the permission it names.
 *
 * It is the queue counterpart of `app/admin/inventory/tool-write-context.ts`,
 * and deliberately not the same helper: the editor's writes all carry a
 * revision token and all touch the same tool, and neither is true here. A
 * status change is a single click on a single row from a single person's
 * screen — there is nothing to lose to a concurrent write but a value somebody
 * can set again, and a conflict dialogue on a queue somebody is trying to clear
 * in ten minutes costs more than it protects.
 *
 * Not a `"use server"` module: nothing here is an endpoint, and a module with
 * that directive may export only async functions.
 */

/** What a queue action answers. A refusal is a value the island can render. */
export type QueueActionResult<E extends string> =
  | { ok: true; warning?: AdminActionWarning }
  | { ok: false; error: AdminGateError | E };

/** What the data layer answers: `ok`, or a refusal naming its own reason. */
export type QueueWriteOutcome<E extends string> = { ok: true } | { ok: false; reason: E };

export interface QueueWrite<E extends string> {
  /** The one permission this surface needs. Checked here, never by the page. */
  permission: Permission;
  /** The page to refresh once the change has landed. */
  path: string;
  /** Names the surface in the console line a failure leaves behind. */
  surface: string;
  /** The change itself, against `src/lib/data/`. Throws on a database failure. */
  write: (identity: Identity) => Promise<QueueWriteOutcome<E>>;
  /**
   * Anything owed *after* the row has changed — an audit event, a cache tag.
   *
   * It answers with a warning or nothing, never a failure, because by the time
   * it runs the change is committed. That is the whole of trap #1: an island
   * answers a refusal by restoring the previous value, so reporting a lost
   * audit event as `{ ok: false }` would leave the page asserting a state the
   * database no longer holds (§4.11, Article 4).
   */
  afterCommit?: (identity: Identity) => Promise<AdminActionWarning | undefined>;
  /**
   * The caller, when it is already known — MCP's `update_ticket` resolves it
   * from a bearer token, not a cookie. The same gate runs either way.
   */
  identity?: Identity;
}

/**
 * Gate, write, record, refresh — each step only as far as the last one earned.
 *
 * A refusal stops at the write: nothing changed, so there is nothing to record
 * and nothing stale to refresh, and re-rendering the queue for it buys a page
 * of queries for no reason.
 *
 * **A thrown error becomes `failed`.** The data layer throws on a database
 * failure because its callers have to tell "we declined" from "we do not
 * know"; a server action may not, because a throw reaches the browser as a
 * digest and an error boundary rather than as a sentence next to the control.
 * The stack goes to the console, where the operator can find it.
 */
export async function runQueueWrite<E extends string>(
  options: QueueWrite<E>
): Promise<QueueActionResult<E>> {
  const gate = await authorizeAdminAction(options.permission, options.identity);
  if (!gate.ok) return gate;

  let outcome: QueueWriteOutcome<E>;
  try {
    outcome = await options.write(gate.identity);
  } catch (err) {
    console.error(`[${options.surface}] the write failed`, err);
    return { ok: false, error: "failed" };
  }

  if (!outcome.ok) return { ok: false, error: outcome.reason };

  const warning = await options.afterCommit?.(gate.identity);

  // The change has landed; a refresh that cannot be scheduled from this caller
  // (the chat's `update_ticket` runs inside a streaming response) must not turn
  // it into a failure the caller would report as "nothing changed".
  try {
    revalidatePath(options.path);
  } catch (err) {
    console.warn(`[${options.surface}] could not refresh ${options.path}`, err);
  }
  // Spread, so a clean success carries no `warning` key at all.
  return { ok: true, ...(warning ? { warning } : {}) };
}
