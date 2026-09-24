import type { AdminActionWarning, AdminGateError } from "../../../lib/admin/action-result";
import type { Role } from "../../../lib/db/schema/vocabulary";

/**
 * What a `/admin/users` server action answers, and where it lives.
 *
 * Its own module because `actions.ts` carries `"use server"`, and a module with
 * that directive may export **only async functions** — every export becomes a
 * callable endpoint. A shared constant and a result type therefore cannot live
 * there, and a client island that only needs the shape should not have to
 * import the endpoints to get it.
 *
 * The codes every admin surface shares live in `src/lib/admin/action-result.ts`;
 * this module adds the ones only this page can answer.
 */

/** The page these actions belong to, and the path they invalidate. */
export const ADMIN_USERS_PATH = "/admin/users";

/**
 * Why an action did nothing. Every code has an `admin.errors.<code>` message in
 * `messages/en.json`; the union is what keeps the two in step.
 *
 * The first four are {@link AdminGateError} — signed in, permitted, within the
 * rate ceiling, and "the write did not land" — shared with every other admin
 * surface so a refusal reads the same wherever it happens. The rest are this
 * page's own:
 *
 * - `unknown_user` / `invalid_role` — the target or the value.
 * - `protected_floor` — the address is in `AUTH_SUPER_ADMIN_EMAILS`.
 * - `last_super_admin` — the change would leave nobody holding `users.manage`.
 * - `self_ban` — banning yourself; the plugin refuses it too.
 */
export type AdminActionError =
  | AdminGateError
  | "unknown_user"
  | "invalid_role"
  | "protected_floor"
  | "last_super_admin"
  | "self_ban";

/**
 * Re-exported, not redefined: the islands on this page import their result
 * shape from here and would otherwise need a second import to render a warning
 * they already received. See `src/lib/admin/action-result.ts` for why a missing
 * audit event rides on a success.
 */
export type { AdminActionWarning };

export type AdminActionResult =
  | { ok: true; role?: Role; banned?: boolean; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };
