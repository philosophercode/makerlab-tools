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

export type AdminActionResult =
  | { ok: true; role?: Role; banned?: boolean }
  | { ok: false; error: AdminActionError };
