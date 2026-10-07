import { eq, gt, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { user } from "../db/schema/auth.ts";
import { staffShifts } from "../db/schema/staff-shifts.ts";
import type { Db } from "../db/types.ts";

/**
 * `staff_shifts` (migration `0029`, on-shift spec 2026-10-07): who marked
 * themselves on shift, and until when.
 *
 * Storage only. Who may mark themselves is the action's (`shifts.set`), and
 * who students see is `lib/on-shift/names.ts`. Relative imports with `.ts`
 * extensions, no `"server-only"`, like every module under `src/lib/data/`.
 */

/** One person's shift, as the readers need it. */
export interface StaffShiftRow {
  userId: string;
  name: string;
  email: string;
  role: string | null;
  banned: boolean | null;
  /** ISO. */
  endsAt: string;
}

/** Mark `userId` on shift until `endsAt`, replacing any shift they had. */
export async function startShift(userId: string, endsAt: Date, options: { db?: Db } = {}): Promise<void> {
  const db = options.db ?? (await getDb());
  await db
    .insert(staffShifts)
    .values({ userId, endsAt })
    .onConflictDoUpdate({ target: staffShifts.userId, set: { endsAt, startedAt: sql`now()` } });
}

/** End `userId`'s shift now. Answers whether there was a row to end. */
export async function endShift(userId: string, options: { db?: Db } = {}): Promise<{ ended: boolean }> {
  const db = options.db ?? (await getDb());
  const deleted = await db.delete(staffShifts).where(eq(staffShifts.userId, userId)).returning({ userId: staffShifts.userId });
  return { ended: deleted.length > 0 };
}

/** `userId`'s shift end (ISO) when they have one that has not ended at `now`, else null. */
export async function getOwnShiftEnd(userId: string, options: { db?: Db; now?: Date } = {}): Promise<string | null> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  const [row] = await db
    .select({ endsAt: staffShifts.endsAt })
    .from(staffShifts)
    .where(eq(staffShifts.userId, userId))
    .limit(1);
  if (!row) return null;
  const endsAt = new Date(row.endsAt);
  return endsAt.getTime() > now.getTime() ? endsAt.toISOString() : null;
}

/**
 * Every shift that has not ended by `now`, with the person's name, address,
 * role and ban as the user row holds them — what deciding who may appear
 * needs. The address never leaves the server: the reader only checks it
 * against the super-admin floor.
 */
export async function listCurrentShifts(options: { db?: Db; now?: Date } = {}): Promise<StaffShiftRow[]> {
  const db = options.db ?? (await getDb());
  const now = options.now ?? new Date();
  const rows = await db
    .select({
      userId: staffShifts.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      endsAt: staffShifts.endsAt,
    })
    .from(staffShifts)
    .innerJoin(user, eq(user.id, staffShifts.userId))
    .where(gt(staffShifts.endsAt, now));
  return rows.map((row) => ({ ...row, endsAt: new Date(row.endsAt).toISOString() }));
}
