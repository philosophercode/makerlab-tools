import { eq } from "drizzle-orm";
import { recordAuditEvent } from "../data/audit.ts";
import { getDb } from "../db/client.ts";
import { user } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { setEventOff } from "./preferences.ts";
import type { UnsubscribeClaim } from "./unsubscribe.ts";

/**
 * The one-click unsubscribe's write (email notifications spec §5.4, §3.7):
 * turn the claim's event off for the claim's person, and audit it.
 *
 * Authorised by the signed token, not a session: it works signed out, from a
 * mail client's RFC 8058 POST or from the confirm page's button. It can only
 * turn something off. The preference and its audit row share a transaction.
 *
 * - A person who no longer exists: nothing to do, answered as already off.
 * - Already off: no change and no second audit row.
 */
export type UnsubscribeOutcome = { ok: true; changed: boolean };

export async function applyUnsubscribe(claim: UnsubscribeClaim, options: { db?: Db } = {}): Promise<UnsubscribeOutcome> {
  const db = options.db ?? (await getDb());
  const [person] = await db.select({ id: user.id }).from(user).where(eq(user.id, claim.userId)).limit(1);
  if (!person) return { ok: true, changed: false };

  return db.transaction(async (tx) => {
    const { from } = await setEventOff(tx, claim.userId, claim.event);
    if (from === "off") return { ok: true, changed: false };
    await recordAuditEvent(
      {
        actorUserId: claim.userId,
        action: "notification.unsubscribed",
        subjectType: "user",
        subjectId: claim.userId,
        detail: { event: claim.event, from, to: "off" },
        surface: "gui",
      },
      { db: tx }
    );
    return { ok: true, changed: true };
  });
}
