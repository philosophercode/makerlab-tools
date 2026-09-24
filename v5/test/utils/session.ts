import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDb } from "../../src/lib/db/client";
import { session, user } from "../../src/lib/db/schema/index";
import { SESSION_MAX_AGE_SECONDS } from "../../src/lib/auth/config";
import { BETTER_AUTH_SESSION_COOKIE, signCookieValue } from "./better-auth-cookie";
import type { Role } from "../../src/lib/auth/roles";
import type { Db } from "../../src/lib/db/types";

/**
 * Seed a signed-in person, without Google.
 *
 * This is the helper that makes Phase 4 testable. Sessions are database rows
 * now, and the cookie carries only a token, so a test does not need an OAuth
 * handshake to be somebody — it needs a `user` row, a `session` row, and a
 * cookie signed the way Better Auth signs one.
 *
 * The cookie format lives in `./better-auth-cookie.ts`, which has no imports
 * so Playwright can load it too. `session.test.ts` proves that format against
 * a real `auth.api.getSession()` — the one assertion that licenses every other
 * test to trust this file.
 *
 * Node environment only (`// @vitest-environment node`): it touches PGlite.
 */

export { BETTER_AUTH_SESSION_COOKIE, signCookieValue };

export interface SeedUserOptions {
  /** Fix the id, for a test that asserts on a specific `created_by` value. */
  id?: string;
  email?: string;
  role?: Exclude<Role, "anonymous">;
  name?: string;
  /** Profile photo URL, as Google would have supplied it. */
  image?: string | null;
  banned?: boolean;
  banReason?: string | null;
}

export interface SeededUser {
  id: string;
  email: string;
  name: string;
  role: Exclude<Role, "anonymous">;
  banned: boolean;
}

/** Insert a `user` row. Defaults to an ordinary institutional student. */
export async function seedUser(options: SeedUserOptions = {}): Promise<SeededUser> {
  return insertUserRow(await getDb(), options);
}

/**
 * The same, against a handle the caller already has.
 *
 * `src/lib/data/*` tests each run their own isolated `createPgliteDb()`, and
 * since Phase 4 their writes have a real foreign key: a `created_by` naming no
 * `user` row is refused. They seed the author through this.
 */
export async function insertUserRow(
  db: Db,
  options: SeedUserOptions = {}
): Promise<SeededUser> {
  const id = options.id ?? `test-user-${randomUUID()}`;
  const row: SeededUser = {
    id,
    email: options.email ?? `${id}@cornell.edu`,
    name: options.name ?? "Test Person",
    role: options.role ?? "user",
    banned: options.banned ?? false,
  };

  // `on conflict do nothing`, then read back: the demo database is not reset
  // between every test, so seeding the same person twice in one file should be
  // a no-op rather than a key error in a test that is about something else.
  // Reading back matters — the caller needs the id that is actually in the
  // table, not the one this call would have used.
  const [inserted] = await db
    .insert(user)
    .values({
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: true,
      image: options.image ?? null,
      role: row.role,
      banned: row.banned,
      banReason: options.banReason ?? null,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) return row;

  const [existing] = await db.select().from(user).where(eq(user.email, row.email));
  return {
    id: existing.id,
    email: existing.email,
    name: existing.name,
    role: (existing.role ?? "user") as SeededUser["role"],
    banned: Boolean(existing.banned),
  };
}

export interface SignedInSession {
  user: SeededUser;
  /** The raw session token — the value inside the signed cookie. */
  token: string;
  /** `name=value`, ready for a `Cookie` request header. */
  cookie: string;
}

export interface SignInAsOptions {
  /** Seconds from now until the session row expires. Negative for an expired one. */
  expiresInSeconds?: number;
  /** Sign the cookie with a different secret, to test a forged one. */
  secret?: string;
}

/**
 * Insert a `session` row for `person` and mint the cookie that addresses it.
 *
 * `AUTH_SECRET` must already be stubbed — the cookie is signed with it, and a
 * cookie signed with nothing is a cookie Better Auth will not accept.
 */
export async function signInAs(
  person: SeededUser,
  options: SignInAsOptions = {}
): Promise<SignedInSession> {
  const secret = options.secret ?? process.env.AUTH_SECRET ?? "";
  if (!secret) {
    throw new Error(
      "signInAs needs AUTH_SECRET stubbed — an unsigned cookie is never accepted"
    );
  }

  const token = `test-session-${randomUUID()}`;
  const ttl = options.expiresInSeconds ?? SESSION_MAX_AGE_SECONDS;

  const db = await getDb();
  await db.insert(session).values({
    id: `test-session-row-${randomUUID()}`,
    token,
    userId: person.id,
    expiresAt: new Date(Date.now() + ttl * 1000),
  });

  const value = await signCookieValue(token, secret);
  return { user: person, token, cookie: `${BETTER_AUTH_SESSION_COOKIE}=${value}` };
}

/** Seed a person and sign them in, in one step. */
export async function signInAsNew(
  options: SeedUserOptions = {},
  signIn: SignInAsOptions = {}
): Promise<SignedInSession> {
  return signInAs(await seedUser(options), signIn);
}

/** A `Cookie` request header, optionally alongside other cookies. */
export function cookieHeader(
  signedIn: SignedInSession | null,
  ...others: string[]
): string {
  return [...others, signedIn?.cookie]
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

/** The same session as a Playwright `context.addCookies()` entry. */
export function playwrightCookie(
  signedIn: SignedInSession,
  { url = "http://localhost:3100" }: { url?: string } = {}
): { name: string; value: string; url: string } {
  const [, ...rest] = signedIn.cookie.split("=");
  return { name: BETTER_AUTH_SESSION_COOKIE, value: rest.join("="), url };
}

