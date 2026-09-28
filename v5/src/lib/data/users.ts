import { and, asc, count, eq, inArray, isNull, ne, or } from "drizzle-orm";
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
 * prompt and not into a log line (spec §8). This roster is not the mirror's
 * source: the Notion mirror selects the emails it carries (maintenance reporter
 * and assignee, project author) itself, in `mirror/source.ts`, as the
 * 2026-09-23 amendment decided.
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
  /** The custom title, or null for the role's default (`lib/people/title.ts`). */
  title: string | null;
  /**
   * When they first had a session, or null for somebody a super admin added
   * who has not signed in yet (migration `0018`, `lib/data/user-add.ts`).
   */
  firstSignedInAt: Date | null;
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

/**
 * Set one person's custom title, or clear it with null. Written here rather
 * than through Better Auth: the column is ours, the admin plugin has no
 * endpoint for it, and `auth/config.ts` declares it `input: false` so no
 * Better Auth endpoint can write it either. The caller has already normalised
 * the value (`normalizeTitle`) and checked `users.manage`; the CHECK is the
 * last word on length. Returns false when no such row exists.
 */
export async function updateUserTitle(
  id: string,
  title: string | null,
  options: UserQueryOptions = {}
): Promise<boolean> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(user)
    .set({ title, updatedAt: new Date() })
    .where(eq(user.id, id))
    .returning({ id: user.id });
  return rows.length > 0;
}

/**
 * Set one person's display name. Written here rather than through Better
 * Auth's `update-user`, which `auth/config.ts` disables: that endpoint takes a
 * name from any signed-in browser with no length rule and no audit event. The
 * caller has already normalised the value (`normalizeName`) and decided who
 * may change it (`lib/people/rename.ts`). Returns false when no such row exists.
 */
export async function updateUserName(
  id: string,
  name: string,
  options: UserQueryOptions = {}
): Promise<boolean> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(user)
    .set({ name, updatedAt: new Date() })
    .where(eq(user.id, id))
    .returning({ id: user.id });
  return rows.length > 0;
}

/**
 * One account by address, or null. The address is compared lower-cased — the
 * way every row stores it — so a Google profile's capitalisation does not
 * matter. Used at sign-in to decide whose name wins (`auth/provider-name.ts`).
 */
export async function findUserByEmail(
  email: string,
  options: UserQueryOptions = {}
): Promise<UserRecord | null> {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(user).where(eq(user.email, normalized)).limit(1);
  return row ? toUserRecord(row) : null;
}

/**
 * Stamp a person's first sign-in, if they have not had one. Called from the
 * session create hook in `auth/config.ts` on every new session; only a row a
 * super admin added ahead of time is ever still null, so for everybody else
 * this matches nothing. Returns true when it stamped one.
 */
export async function markFirstSignIn(userId: string, options: UserQueryOptions = {}): Promise<boolean> {
  if (!userId) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(user)
    .set({ firstSignedInAt: new Date() })
    .where(and(eq(user.id, userId), isNull(user.firstSignedInAt)))
    .returning({ id: user.id });
  return rows.length > 0;
}

/** A `user` row as the roster reads it. Shared with `user-add.ts`. */
export function toUserRecord(row: typeof user.$inferSelect): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    // The `user_role_check` constraint makes anything else impossible; the cast
    // is the type system catching up with the database, not a guess.
    role: (row.role ?? "user") as Role,
    banned: Boolean(row.banned),
    banReason: row.banReason ?? null,
    title: row.title ?? null,
    firstSignedInAt: row.firstSignedInAt ?? null,
    createdAt: row.createdAt,
  };
}

/**
 * The accounts a maintenance ticket can be assigned to (spec §5.6).
 *
 * Everyone who holds an admin role and is not banned, by name. It is a
 * *convenience*, not a permission model: `assigned_to_user_id` has no meaning
 * to `can()` — assigning a ticket to somebody grants them nothing and requires
 * nothing of them — so this list only has to be the people it is plausible to
 * assign work to. Offering the whole roster would put four hundred students in
 * a select whose job is picking one of three SuperMakers.
 *
 * Banned accounts are left out because they cannot sign in to see the ticket.
 * A ticket already assigned to somebody who has since been banned or demoted
 * keeps its `assigned_to_name` snapshot, so the queue still says who has it.
 */
export async function listAssignableStaff(options: UserQueryOptions = {}): Promise<UserRecord[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select()
    .from(user)
    .where(
      and(
        inArray(user.role, ["admin", "super_admin"]),
        // `banned` is nullable, and `banned <> true` is *unknown* for a null in
        // SQL — the same trap `countUsersWithRole` spells out.
        or(eq(user.banned, false), isNull(user.banned))
      )
    )
    .orderBy(asc(user.name), asc(user.email));
  return rows.map(toUserRecord);
}
