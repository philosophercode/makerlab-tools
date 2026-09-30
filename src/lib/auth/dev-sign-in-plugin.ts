import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";

import { devSignInEnvEnabled } from "./dev-sign-in";
import { isAllowedEmail, normalizeEmail } from "./roles";

/**
 * The Better Auth half of development-only sign-in (auth spec amendment
 * 2026-09-24).
 *
 * One endpoint, `auth.api.devSignIn`, that does what the Google callback does
 * after Google has vouched for an address: find or create the user, create a
 * session row, set the session cookie. It runs **inside** Better Auth, so none
 * of that is re-implemented here:
 *
 * - **Creating the user** goes through `internalAdapter.createUser`, which runs
 *   the same `databaseHooks.user.create.before` chain as a Google sign-in —
 *   `config.ts`'s domain/allowlist refusal and the `AUTH_SUPER_ADMIN_EMAILS`
 *   floor, then the admin plugin's `defaultRole`. A new address therefore gets
 *   exactly the role a first Google sign-in would give it.
 * - **Creating the session** goes through `internalAdapter.createSession`,
 *   which runs the admin plugin's `session.create.before` — the `BANNED_USER`
 *   refusal.
 * - **The cookie** is `setSessionCookie`, Better Auth's own: same name, same
 *   signature, same attributes. Nothing here signs anything.
 * - **The after-hook** in `config.ts` sees the new session like any other and
 *   refuses an out-of-domain one.
 *
 * **It is `SERVER_ONLY`**: Better Auth's router skips it, so there is no
 * `/api/auth/dev-sign-in` URL in any environment. The only caller is
 * `app/api/dev/sign-in/route.ts`, which checks every guard first; the handler
 * re-checks the environment guards anyway, so the endpoint is inert in a
 * production build even if something else ever called it.
 */
export function devSignInPlugin() {
  return {
    id: "makerlab-dev-sign-in",
    endpoints: {
      devSignIn: createAuthEndpoint(
        "/dev-sign-in",
        {
          method: "POST",
          body: z.object({ email: z.string() }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          if (!devSignInEnvEnabled()) {
            throw APIError.from("NOT_FOUND", {
              message: "Not found",
              code: "DEV_SIGN_IN_DISABLED",
            });
          }

          const email = normalizeEmail(ctx.body.email);
          // The create hook refuses this too; checking first keeps an existing
          // out-of-domain row (a restored backup) from getting a session.
          if (!email || !isAllowedEmail(email)) {
            throw APIError.from("FORBIDDEN", {
              message: "This address may not sign in",
              code: "EMAIL_NOT_ALLOWED",
            });
          }

          const adapter = ctx.context.internalAdapter;
          const existing = await adapter.findUserByEmail(email);
          let user = existing?.user ?? null;
          let created = false;
          if (!user) {
            user = await adapter.createUser({
              email,
              name: email.split("@")[0] || email,
              emailVerified: true,
            });
            created = true;
          }
          if (!user) {
            throw APIError.from("FORBIDDEN", {
              message: "This address may not sign in",
              code: "EMAIL_NOT_ALLOWED",
            });
          }

          // Throws `BANNED_USER` for a banned row (the admin plugin's hook).
          const session = await adapter.createSession(user.id);
          if (!session) {
            throw APIError.from("INTERNAL_SERVER_ERROR", {
              message: "Could not create a session",
              code: "SESSION_NOT_CREATED",
            });
          }

          await setSessionCookie(ctx, { session, user });
          return ctx.json({ userId: user.id, created });
        }
      ),
    },
  } satisfies BetterAuthPlugin;
}
