import { isAllowedEmail, normalizeEmail, parseEmailList } from "./roles";

/**
 * The super-admin floor (data platform design spec §3.4).
 *
 * `AUTH_SUPER_ADMIN_EMAILS` is **a floor, not a roster**. An address listed
 * there is created as `super_admin` and resolves as `super_admin` whatever its
 * row says, and `/admin/users` refuses to demote or ban it. Two things depend
 * on that:
 *
 * 1. **Bootstrap.** No `user` row exists until somebody signs in, so there is
 *    no first admin to promote anybody. The floor is how the first one comes to
 *    exist — the listed person signs in and is already a super admin.
 * 2. **Lock-out.** A super admin who demotes themselves, or a mistaken ban,
 *    would otherwise leave nobody able to undo it and no UI to fix it with.
 *
 * It is the one piece of the role system still in the environment, and that is
 * deliberate: a floor that lives in the same table it protects protects nothing.
 *
 * Read at call time, never at module load, so a redeploy takes effect without a
 * cold start and tests can `vi.stubEnv` without `resetModules()`.
 */

/** Addresses listed in `AUTH_SUPER_ADMIN_EMAILS`, normalized. */
export function superAdminEmails(): string[] {
  return parseEmailList(process.env.AUTH_SUPER_ADMIN_EMAILS);
}

/**
 * True when `email` is on the floor.
 *
 * The domain check runs here too. An address outside
 * `AUTH_ALLOWED_EMAIL_DOMAIN` can never hold a role — the create hook refuses
 * to make it a row at all — so honouring it here would grant the highest role
 * to an account that cannot otherwise exist. A typo in the env list must fail
 * closed, not open.
 */
export function isSuperAdminFloor(email: string | null | undefined): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized || !isAllowedEmail(normalized)) return false;
  return superAdminEmails().includes(normalized);
}
