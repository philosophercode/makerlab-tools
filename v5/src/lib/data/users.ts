import { and, asc, count, eq, isNull, ne, or } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { user } from "../db/schema/index.ts";
import type { Role } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";

/**
 * Reading the roster for `/admin/users` (data platform design spec §5.2).
 *
 * **Read straight from Postgres, not through the admin plugin's `list-users`
 * endpoint.** The page is a server component; asking Better Auth would mean a
 * round trip through the auth handler — headers, session re-resolution, the
 * plugin's own pagination — to select from a table this process already has a
 * handle on. The *writes* still go through the plugin (`set-role`, `ban-user`
 * in `app/admin/users/actions.ts`), because those carry behaviour worth having:
 * a ban deletes the person's sessions.
 *
 * Nothing here decides anything. The page gates on `can(identity,
 * "users.manage")` before it calls, and each server action checks again.
 *
 * Emails *are* returned, unlike everywhere else in the app: this is the one
 * surface whose whole job is telling a super admin which account is which, and
 * a roster of display names cannot do that. It goes no further — not into a
 * prompt, not into the mirror, not into a log line (spec §8).
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no `"server-only"`,
 * like every other module under `src/lib/data/`.
 */

/** One account as the admin roster shows it. */
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  /** The stored role. Never `anonymous` — that is the absence of a row. */
  role: Role;
  banned: boolean;
  banReason: string | null;
  createdAt: Date;
}

export interface UserQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Every account, ordered by email.
 *
 * Unpaginated on purpose. The roster is one lab's SuperMakers and the students
 * who have signed in — hundreds, not millions — and a super admin looking for
 * one person is better served by one page they can search in the browser than
 * by a pager. If it ever stops being one screenful, that is the moment to add
 * one, and the call site is this function.
 */
export async function listUsers(options: UserQueryOptions = {}): Promise<UserRecord[]> {
  const db = options.db ?? (await getDb());
  const rows = await db.select().from(user).orderBy(asc(user.email));
  return rows.map(toUserRecord);
}

/**
 * One account by id, or null.
 *
 * The role-change action needs this *before* it calls the plugin, for two
 * reasons it cannot get any other way: the email, to test against the
 * super-admin floor, and the current role, so the audit event can say what the
 * change was rather than only what it became.
 */
export async function findUserById(
  id: string,
  options: UserQueryOptions = {}
): Promise<UserRecord | null> {
  if (!id) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(user).where(eq(user.id, id)).limit(1);
  return row ? toUserRecord(row) : null;
}

/**
 * How many accounts hold `role`, ignoring one id.
 *
 * `excludeUserId` is the person about to be changed, so the caller asks "who
 * would still hold this afterwards?" rather than "who holds it now?" — which is
 * what "the last super admin demotes themselves" (spec §10) actually needs to
 * know. Banned accounts are not counted: a banned super admin resolves to
 * anonymous on every request and cannot undo anything.
 */
export async function countUsersWithRole(
  role: Role,
  { excludeUserId, db: handle }: UserQueryOptions & { excludeUserId?: string } = {}
): Promise<number> {
  const db = handle ?? (await getDb());
  // `banned` is nullable (Better Auth declares it optional), and in SQL
  // `banned <> true` is unknown — not true — for a null. Spelling both out is
  // the difference between "nobody is left" and "nobody is left that I noticed".
  const conditions = [
    eq(user.role, role),
    or(eq(user.banned, false), isNull(user.banned)),
  ];
  if (excludeUserId) conditions.push(ne(user.id, excludeUserId));

  const [row] = await db
    .select({ total: count() })
    .from(user)
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

function toUserRecord(row: typeof user.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    // The `user_role_check` constraint makes anything else impossible; the cast
    // is the type system catching up with the database, not a guess.
    role: (row.role ?? "user") as Role,
    banned: Boolean(row.banned),
    banReason: row.banReason ?? null,
    createdAt: row.createdAt,
  };
}
