import "server-only";

import { touchTool } from "../data/tools";
import type { Revision } from "../data/revision";
import type { Refused } from "../data/write-result";
import { getDb } from "../db/client";
import type { Db } from "../db/types";
import { invalidateCatalog } from "../revalidate";
import type { InventoryWriteError, InventoryWriteResult } from "./result";

/**
 * The shape every child write in the tool editor takes (spec §5.3).
 *
 * A unit, a resource or a photo is edited through a panel whose concurrency
 * token is the **tool's**, so each of those writes is three things that have to
 * happen together:
 *
 * 1. **Touch the tool at the revision the panel holds.** This is the optimistic
 *    check and the bump in one statement: if it matches nothing, somebody else
 *    has edited this tool and this write does not happen. If it matches, the
 *    tool's `updated_at` moves, so *their* panel finds out about this write too.
 * 2. **The child write itself**, in the same transaction. `now()` is
 *    transaction-start time, so everything written here shares one `updated_at`
 *    and the token that comes back is consistent with all of it.
 * 3. **Invalidate the catalogue**, once, and only if the transaction committed.
 *
 * **A refusal rolls the transaction back.** A duplicate serial number or a unit
 * that belongs to another tool must leave the tool's revision exactly where it
 * was: bumping it would invalidate the panel's token — and everybody else's —
 * over a write that never happened. Drizzle only rolls back on a throw, so a
 * refusal travels out as {@link Refusal} and becomes a value again at the edge.
 */

/** What every child write needs to know before it can run. */
export interface ToolWriteContext {
  toolId: string;
  /** The token the panel received when it opened. */
  expectedRevision: Revision;
  /** The signed-in person; stamped onto `updated_by` all the way down. */
  actorUserId?: string | null;
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/** A refusal on its way out of a transaction that must not commit. */
class Refusal extends Error {
  constructor(readonly error: InventoryWriteError) {
    super(`inventory write refused: ${error}`);
    this.name = "Refusal";
  }
}

/**
 * Run `body` inside a transaction that has already touched the tool, and
 * invalidate the catalogue if it commits.
 *
 * `body` answers the data layer's own `{ ok: false, reason }`, which is
 * translated into this layer's `error` at one place — here.
 */
export async function withTouchedTool<T extends object>(
  context: ToolWriteContext,
  body: (tx: Db) => Promise<({ ok: true } & T) | Refused>
): Promise<InventoryWriteResult<T>> {
  const db = context.db ?? (await getDb());

  let result: InventoryWriteResult<T>;
  try {
    result = await db.transaction(async (tx) => {
      const touched = await touchTool(
        tx,
        context.toolId,
        context.expectedRevision,
        context.actorUserId
      );
      if (!touched.ok) throw new Refusal(touched.reason);

      const written = await body(tx);
      if (!written.ok) throw new Refusal(written.reason);

      return { ...written, revision: touched.revision };
    });
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, error: err.error };
    throw err;
  }

  // After the commit, never before: a rolled-back write has nothing to show,
  // and busting the cache for it would cost a full catalogue re-read for free.
  invalidateCatalog();
  return result;
}
