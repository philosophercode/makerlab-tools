import { ROLES as STORED_ROLES, type Role as StoredRole } from "../db/schema/vocabulary";

/**
 * The role vocabulary and the domain rule (data platform design spec §3.4).
 *
 * **Roles are rows now.** Until Phase 4 there was no user table, so two
 * comma-separated env lists (`AUTH_STAFF_EMAILS`, `AUTH_ADMIN_EMAILS`) *were*
 * the role system and this module resolved a role from an address. Both lists
 * are retired: `user.role` is a column, changed on `/admin/users` and visible on
 * the person's next request. The one env list that survives is
 * `AUTH_SUPER_ADMIN_EMAILS`, the lock-out floor — see `super-admins.ts`.
 *
 * What is left here is what has no home in the database: the shape of the role
 * union, and the domain rule that decides whose address may become a row at all.
 *
 * Every lookup reads `process.env` at **call time** rather than at module load,
 * so a redeploy with a new value takes effect without a cold-start dance and
 * tests can `vi.stubEnv` without `resetModules()`.
 *
 * Deliberately not `server-only`: `Role` is universal and client components
 * compare against it. The env-reading helpers resolve to their empty answer in a
 * browser bundle, which is safe — the server check is the control.
 */

/**
 * The roles an identity can hold. The three stored ones come from
 * `db/schema/vocabulary.ts`, which is also what the `user.role` CHECK is built
 * from, so the type and the constraint cannot drift. `anonymous` is never a row:
 * it is the absence of a session, which is a first-class state, not a failure.
 *
 * There is deliberately **no ordering** here. `student < staff < admin` was a
 * rank comparison (`isAtLeast`); what a role may do is now declared in
 * `permissions.ts` and asked with `can()`, so that "SuperMakers may add tools
 * but not publish them" is one line of declaration rather than a reshuffle.
 */
export const IDENTITY_ROLES = ["anonymous", ...STORED_ROLES] as const;

export type Role = "anonymous" | StoredRole;

/** True when `value` is one of {@link IDENTITY_ROLES}; narrows the type. */
export function isRole(value: string | null | undefined): value is Role {
  return typeof value === "string" && (IDENTITY_ROLES as readonly string[]).includes(value);
}

/**
 * A stored role read back from the database, or `anonymous` for anything else.
 * A row carrying a word outside the vocabulary should be impossible (the CHECK
 * refuses it), so if one ever appears it is a bug or a restored backup from a
 * different schema, and it must resolve to the role that holds nothing.
 */
export function storedRoleOr(value: string | null | undefined): Role {
  return isRole(value) ? value : "anonymous";
}

/** The institution's Google Workspace domain, when nothing overrides it. */
const DEFAULT_EMAIL_DOMAIN = "cornell.edu";

/**
 * The email domain sign-in is restricted to. Configurable so the app stays
 * white-labelled (Article 6) — the default is the Cornell Tech deployment's.
 */
export function allowedEmailDomain(): string {
  const configured = (process.env.AUTH_ALLOWED_EMAIL_DOMAIN || "").trim();
  return (configured || DEFAULT_EMAIL_DOMAIN).replace(/^@/, "").toLowerCase();
}

/**
 * Server-side domain check. Google's `hd` parameter narrows the account picker
 * and is a **UI hint, not a security control** — this is the enforcement, and it
 * runs again on every request that resolves an identity.
 */
export function isAllowedEmail(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return normalized.endsWith(`@${allowedEmailDomain()}`);
}

/** Lower-case and trim an address; returns "" for anything unusable. */
export function normalizeEmail(email: string | null | undefined): string {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

/** Parse a comma-separated env list of addresses into a normalized array. */
export function parseEmailList(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((entry) => normalizeEmail(entry))
    .filter(Boolean);
}
