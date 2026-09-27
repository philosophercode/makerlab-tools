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
 * - `protected_floor` — the address is in `AUTH_SUPER_ADMIN_EMAILS`: it cannot
 *   be demoted, removed or blocked.
 * - `last_super_admin` — the change would leave nobody holding `users.manage`.
 * - `self_remove` — removing your own account (auth spec amendment 2026-09-25).
 * - `invalid_title` — a title that is not text, or is longer than
 *   `USER_TITLE_MAX_LENGTH` once trimmed.
 * - `invalid_name` — a name longer than `PERSON_NAME_MAX_LENGTH` once
 *   trimmed, or (for **Edit name**, where a name is required) blank.
 * - **Add person** only: `invalid_email` (not an address), `email_not_allowed` (outside the
 *   domain rule and `AUTH_ALLOWED_EMAILS`), `email_blocked` (on the blocked
 *   list) and `duplicate_email` (somebody already has that address).
 */
export type AdminActionError =
  | AdminGateError
  | "unknown_user"
  | "invalid_role"
  | "protected_floor"
  | "last_super_admin"
  | "self_remove"
  | "invalid_title"
  | "invalid_email"
  | "invalid_name"
  | "email_not_allowed"
  | "email_blocked"
  | "duplicate_email";

/**
 * The longest name kept — at Add person, **Edit name** here, and on
 * `/account`. Re-exported so the islands on this page need one import.
 */
export { PERSON_NAME_MAX_LENGTH } from "../../../lib/people/name";

/**
 * Re-exported, not redefined: the islands on this page import their result
 * shape from here and would otherwise need a second import to render a warning
 * they already received. See `src/lib/admin/action-result.ts` for why a missing
 * audit event rides on a success.
 */
export type { AdminActionWarning };

export type AdminActionResult =
  | { ok: true; role?: Role; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/**
 * What **Remove** answers (auth spec amendment 2026-09-25). `blocked` says
 * whether the address is now on the blocked list; the page names both.
 */
export type RemoveUserResult =
  | { ok: true; removed: { id: string; name: string; email: string }; blocked: boolean; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/** What **Unblock** answers. Unblocking an address not on the list is a no-op success. */
export type UnblockEmailResult =
  | { ok: true; email: string; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/**
 * What saving a title answers. `title` is what is now stored — null for the
 * role's default — so the editor shows the server's normalised value, not
 * what was typed.
 */
export type SetTitleResult =
  | { ok: true; title: string | null; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/**
 * What saving a name answers. `name` is what is now stored — trimmed, inner
 * whitespace collapsed — so the editor shows the server's value.
 */
export type SetNameResult =
  | { ok: true; name: string; warning?: AdminActionWarning }
  | { ok: false; error: AdminActionError };

/** What **Add person** answers: the new row, as the roster shows it. */
export type AddPersonResult =
  | {
      ok: true;
      person: { id: string; name: string; email: string; role: Role; title: string | null };
      warning?: AdminActionWarning;
    }
  | { ok: false; error: AdminActionError };

export interface AddPersonInput {
  email: string;
  name?: string;
  role: string;
  title?: string | null;
}

export type AddPersonAction = (input: AddPersonInput) => Promise<AddPersonResult>;
export type SetTitleAction = (input: { userId: string; title: string | null }) => Promise<SetTitleResult>;
export type SetNameAction = (input: { userId: string; name: string }) => Promise<SetNameResult>;
export type RemoveUserAction = (input: { userId: string; block: boolean; reason?: string }) => Promise<RemoveUserResult>;
export type UnblockEmailAction = (input: { email: string }) => Promise<UnblockEmailResult>;
