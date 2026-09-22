import type { Role } from "../../../lib/db/schema/vocabulary";

/**
 * What a `/admin/users` server action answers, and where it lives.
 *
 * Its own module because `actions.ts` carries `"use server"`, and a module with
 * that directive may export **only async functions** — every export becomes a
 * callable endpoint. A shared constant and a result type therefore cannot live
 * there, and a client island that only needs the shape should not have to
 * import the endpoints to get it.
 */

/** The page these actions belong to, and the path they invalidate. */
export const ADMIN_USERS_PATH = "/admin/users";

/**
 * Why an action did nothing. Every code has an `admin.errors.<code>` message in
 * `messages/en.json`; the union is what keeps the two in step.
 *
 * - `not_signed_in` / `not_permitted` — told apart on purpose: one is
 *   actionable and the other is not.
 * - `protected_floor` — the address is in `AUTH_SUPER_ADMIN_EMAILS`.
 * - `last_super_admin` — the change would leave nobody holding `users.manage`.
 * - `self_ban` — banning yourself; the plugin refuses it too.
 * - `failed` — the write did not land. Deliberately opaque to the browser.
 */
export type AdminActionError =
  | "not_signed_in"
  | "not_permitted"
  | "rate_limited"
  | "unknown_user"
  | "invalid_role"
  | "protected_floor"
  | "last_super_admin"
  | "self_ban"
  | "failed";

/**
 * A change that landed with less than the full guarantee behind it.
 *
 * - `audit_unavailable` — the row changed and `audit_events` did not record it.
 *
 * It rides on `ok: true` deliberately. The plugin's write commits in its own
 * statement, and with the Neon HTTP driver the audit insert is a second request
 * that can fail on its own; reporting that as a failure would make the island
 * snap back to the previous value and leave the page asserting a role the
 * database no longer holds — the one thing `RoleSelect` promises never to do.
 * Reporting it as a plain success would leave a hole in the trail nobody was
 * told about (spec §4.11, Article 4). So it is a success that says what is
 * missing, and every code has an `admin.warnings.<code>` message.
 */
export type AdminActionWarning = "audit_unavailable";

export type AdminActionResult =
  | { ok: true; role?: Role; banned?: boolean; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };
