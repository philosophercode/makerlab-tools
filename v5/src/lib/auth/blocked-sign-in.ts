import "server-only";

import { APIError } from "better-auth/api";

import { isEmailBlocked } from "../data/blocked-emails";
import type { Db } from "../db/types";
import { isSuperAdminFloor } from "./super-admins";

/**
 * Refusing a blocked address at sign-in (auth spec amendment 2026-09-25,
 * "Remove a person, and block an address").
 *
 * Called from `databaseHooks.user.create.before` in `config.ts` — the same
 * place, and the same "no account is created" guarantee, as the domain rule.
 * Removal deletes the account and blocks the address in one transaction, so a
 * blocked address never has a row to sign in *to*: refusing to create one is
 * the whole of the control.
 *
 * **The floor outranks the list.** An address in `AUTH_SUPER_ADMIN_EMAILS` is
 * never blocked by the app, and a block that names one anyway (written before
 * the address joined the floor, or by hand) is ignored — the environment is the
 * lock-out guarantee, and a list in the database it protects cannot overrule it.
 */

/**
 * The code a refused sign-up carries. Better Auth's OAuth callback turns the
 * thrown error's message into `?error=<this>` on its error redirect, which the
 * auth route rewrites to {@link BLOCKED_SIGN_IN_PATH}.
 */
export const EMAIL_BLOCKED_CODE = "email_blocked";

/** Where a blocked address lands: the domain page's twin. */
export const BLOCKED_SIGN_IN_PATH = "/auth/blocked";

/** True when `email` may not become an account. */
export async function isSignUpBlocked(email: string | null | undefined, db?: Db): Promise<boolean> {
  if (isSuperAdminFloor(email)) return false;
  return isEmailBlocked(email, db ? { db } : {});
}

/** The error the create hook throws for a blocked address. */
export function emailBlockedError(): APIError {
  return APIError.from("FORBIDDEN", { message: EMAIL_BLOCKED_CODE, code: "EMAIL_BLOCKED" });
}

/**
 * If `response` is Better Auth sending a refused sign-up to its error page,
 * the same redirect pointed at {@link BLOCKED_SIGN_IN_PATH} instead; otherwise
 * `response` unchanged. Cookies the callback set (clearing its state) ride along.
 */
export function redirectBlockedSignIn(response: Response): Response {
  if (response.status < 300 || response.status >= 400) return response;
  const location = response.headers.get("location");
  if (!location) return response;
  let url: URL;
  try {
    url = new URL(location, "http://localhost");
  } catch {
    return response;
  }
  if (url.searchParams.get("error") !== EMAIL_BLOCKED_CODE) return response;
  const headers = new Headers(response.headers);
  headers.set("location", BLOCKED_SIGN_IN_PATH);
  return new Response(null, { status: response.status, headers });
}
