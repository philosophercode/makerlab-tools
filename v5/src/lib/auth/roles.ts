/**
 * Roles and the domain rule (auth design spec 2026-07-29 §3.3).
 *
 * There is no user database in v5, so role assignment is configuration: two
 * comma-separated env lists name the staff and the admins, and everyone else who
 * signs in with an allowed address is a student. The lab has a handful of staff
 * and the roster changes a few times a year — an env list needs no UI, no table,
 * and no migration, and it is auditable by whoever operates the deployment.
 *
 * Every lookup reads `process.env` at **call time** rather than at module load,
 * so a redeploy with a new roster takes effect without a cold-start dance and
 * tests can `vi.stubEnv` without `resetModules()`.
 *
 * This module is deliberately not `server-only`: `Role` and `isAtLeast` are
 * universal, and the env-reading helpers are only ever called from the server
 * (they resolve to "no one is staff" in a client bundle, which is safe).
 */

/** Ordered least- to most-privileged. The order *is* the privilege ordering. */
export const ROLES = ["anonymous", "student", "staff", "admin"] as const;

export type Role = (typeof ROLES)[number];

/** The institution's Google Workspace domain, when nothing overrides it. */
const DEFAULT_EMAIL_DOMAIN = "cornell.edu";

/** Position of `role` in {@link ROLES}; higher means more privileged. */
export function roleRank(role: Role): number {
  const index = ROLES.indexOf(role);
  return index === -1 ? 0 : index;
}

/** True when `role` is at least as privileged as `minimum`. */
export function isAtLeast(role: Role, minimum: Role): boolean {
  return roleRank(role) >= roleRank(minimum);
}

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

/** Addresses listed in `AUTH_STAFF_EMAILS`. */
export function staffEmails(): string[] {
  return parseEmailList(process.env.AUTH_STAFF_EMAILS);
}

/** Addresses listed in `AUTH_ADMIN_EMAILS`. */
export function adminEmails(): string[] {
  return parseEmailList(process.env.AUTH_ADMIN_EMAILS);
}

/**
 * Resolve a verified address to a role.
 *
 * An address outside the allowed domain resolves to `anonymous` rather than
 * `student`: a cookie carrying one should be impossible (the callback refuses
 * it), so if one ever appears it is a bug or a forgery and must not be trusted.
 */
export function roleForEmail(email: string | null | undefined): Role {
  const normalized = normalizeEmail(email);
  if (!normalized || !isAllowedEmail(normalized)) return "anonymous";
  if (adminEmails().includes(normalized)) return "admin";
  if (staffEmails().includes(normalized)) return "staff";
  return "student";
}
