import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { can } from "../auth/permissions.ts";
import type { Role } from "../auth/roles.ts";
import { ROLES, user } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { NOTIFICATION_EVENT_DEFS, type NotificationEvent } from "./events.ts";
import { deliveryFor, loadPreferences } from "./preferences.ts";

/**
 * Who receives an event (email notifications spec §3.4, G2).
 *
 * Reads `user.id` and `user.role` only, never the address. Keeps the people
 * whose role `can()` the event's permission and who are not banned, then
 * drops anyone whose preference for the event is not `immediate`. It never
 * compares role names (AGENTS.md): a role that gains the permission gains the
 * mail.
 */

/** Bounded like every read (Article 4): a lab's staff is a handful, not thousands. */
const MAX_STAFF = 200;

export interface RecipientCheck {
  ok: boolean;
  /** Why not, when not. */
  reason?: "no_permission" | "pref_off";
}

/** Every user id that should get `event` now, oldest account first. */
export async function resolveRecipients(db: Db, event: NotificationEvent): Promise<string[]> {
  const permission = NOTIFICATION_EVENT_DEFS[event].permission;
  // The roles that hold the permission, asked of can() one role at a time, so
  // the database filters and no role name is written here.
  const granted = ROLES.filter((role) => can({ role }, permission));
  if (granted.length === 0) return [];
  const rows = await db
    .select({ id: user.id, role: user.role })
    .from(user)
    .where(and(inArray(user.role, [...granted]), or(eq(user.banned, false), isNull(user.banned))))
    .orderBy(user.createdAt)
    .limit(MAX_STAFF);
  const holders = rows.filter((row) => can({ role: row.role as Role | null }, permission));
  const prefs = await loadPreferences(
    db,
    holders.map((row) => row.id)
  );
  return holders.filter((row) => deliveryFor(prefs.get(row.id), event) === "immediate").map((row) => row.id);
}

/**
 * The send step's re-check (§3.3 step 2.2): this person still exists, is not
 * banned, still holds the permission, and still wants the event. Time passes
 * between the fan-out and the send.
 */
export async function checkRecipient(db: Db, userId: string, event: NotificationEvent): Promise<RecipientCheck> {
  const [row] = await db
    .select({ role: user.role })
    .from(user)
    .where(and(eq(user.id, userId), or(eq(user.banned, false), isNull(user.banned))))
    .limit(1);
  if (!row || !can({ role: row.role as Role | null }, NOTIFICATION_EVENT_DEFS[event].permission)) {
    return { ok: false, reason: "no_permission" };
  }
  const prefs = await loadPreferences(db, [userId]);
  if (deliveryFor(prefs.get(userId), event) !== "immediate") return { ok: false, reason: "pref_off" };
  return { ok: true };
}
