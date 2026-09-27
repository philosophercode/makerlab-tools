import { revalidatePath } from "next/cache";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import type { Permission } from "../../../lib/auth/permissions";
import type { Revision } from "../../../lib/data/revision";
import type { InventoryWriteResult } from "../../../lib/inventory/result";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import { INVENTORY_PATH, type InventoryActionResult } from "./action-result";

/**
 * The preamble every tool-editor write shares (spec §5.3, §8).
 *
 * Whatever a panel control changes — a field, a unit, a resource, a photo, the
 * tool's state — the action behind it is the same moves: check its own
 * permission, build the write context out of the caller's identity and the
 * token the panel holds, and — only if the write landed — refresh the review
 * table and ask the Notion mirror to catch up (`requestMirrorPush()`, §3.8
 * trigger 1: "publishing, and saving an edit"). Doing it here is what makes
 * every editor write, publish, archive and Looks good a trigger, without each
 * action having to remember.
 * This module owns those moves so `actions.ts` and the three child-section
 * modules beside it hold nothing but the writes they are named after.
 *
 * It is deliberately **not** a `"use server"` module: nothing here is an
 * endpoint, and a module with that directive may export only async functions.
 */

/** What every write on this surface is told by the panel. */
export interface ToolWriteInput {
  toolId: string;
  /** The token the panel received when it opened. */
  expectedRevision: Revision;
}

/** The context the `src/lib/inventory/` writes take, once the gate has run. */
export interface ToolWriteActor extends ToolWriteInput {
  actorUserId: string | null;
}

/**
 * Gate on `permission`, then run one write against the panel's token.
 *
 * The result is passed back unchanged, warning and all. **A warning rides on
 * `ok: true` and must keep doing so**: the row changed, and answering
 * `{ ok: false }` would make the panel restore the previous value and assert a
 * state the database no longer holds (§4.11, Article 4).
 */
export async function withToolWrite<T>(
  permission: Permission,
  input: ToolWriteInput,
  write: (context: ToolWriteActor) => Promise<InventoryWriteResult<T>>
): Promise<InventoryActionResult<T>> {
  const gate = await authorizeAdminAction(permission);
  if (!gate.ok) return gate;

  const result = await write({
    toolId: input.toolId,
    expectedRevision: input.expectedRevision,
    actorUserId: gate.identity.userId,
  });

  // Only on a success: a refused write changed nothing, and re-rendering the
  // review table for it buys a page of queries for no reason — and a push for
  // it would mirror nothing. The catalogue's own invalidation happened inside
  // `src/lib/inventory/`, which is the layer that knows whether the
  // transaction committed. `requestMirrorPush` never throws, so a mirror that
  // cannot be told never turns a landed write into a failure (Article 4).
  if (result.ok) {
    revalidatePath(INVENTORY_PATH);
    await requestMirrorPush();
  }
  return result;
}

/**
 * The same, for the child sections, which are all `tools.edit`.
 *
 * Every one of them is an ordinary edit to the record — including taking a
 * machine out of service, however consequential that feels standing next to the
 * printer. Publishing is the one that is not, and it names its own permission.
 */
export function withToolEdit<T>(
  input: ToolWriteInput,
  write: (context: ToolWriteActor) => Promise<InventoryWriteResult<T>>
): Promise<InventoryActionResult<T>> {
  return withToolWrite("tools.edit", input, write);
}
