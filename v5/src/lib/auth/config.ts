import "server-only";

import { betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins/admin";
import { mcp } from "better-auth/plugins";

import { dataSubstrate, getDb } from "../db/client";
import * as schema from "../db/schema/index";
import { emailBlockedError, isSignUpBlocked } from "./blocked-sign-in";
import { devSignInPlugin } from "./dev-sign-in-plugin";
import { ac, roles } from "./permissions";
import { allowedEmailDomain, allowedEmails, isAllowedEmail } from "./roles";
import { isSuperAdminFloor } from "./super-admins";
import type { Db } from "../db/types";

/**
 * The Better Auth instance (data platform design spec §3.4).
 *
 * **Phase 4 made this the library's ordinary setup.** Before it, v5 had no
 * database, so Better Auth ran the Google handshake into an in-memory adapter
 * and the callback minted a stateless HMAC cookie (`makerlab.identity`) that
 * carried the whole identity. There is a database now, so:
 *
 * - **Storage** is the Drizzle adapter on the same handle everything else uses
 *   — Neon in production, PGlite in tests and demo mode.
 * - **Sessions are rows.** The cookie carries a token; every request looks the
 *   session and its user up. That is what makes a role change land on the
 *   person's next request, and a ban take effect immediately, with nothing to
 *   expire. Better Auth's optional cookie cache stays off for the same reason.
 * - **Roles come from the admin plugin**, configured with *our* access-control
 *   declaration (`permissions.ts`), so `set-role` and `ban-user` answer to the
 *   same grants `can()` does.
 *
 * Domain restriction is still enforced **twice**, deliberately, because Google's
 * `hd` parameter only narrows the account picker:
 *
 * 1. `hd` on the provider — the UI hint, plus Better Auth's own check of the
 *    verified `hd` claim on the returned id token.
 * 2. `databaseHooks.user.create.before` — our own `email.endsWith("@<domain>")`
 *    check, which refuses to create the row at all, and the after-hook below,
 *    which refuses to let an existing foreign account carry a session out.
 *
 * Everything stays optional. With `AUTH_SECRET` unset `getAuth()` is null,
 * nobody is signed in, and the catalogue, the chat and the whole test suite run
 * unchanged. Sign-in unlocks; it never gates the front door.
 */

/** Where a rejected non-institutional account is sent. */
export const DOMAIN_REJECTED_PATH = "/auth/rejected";

/** Mount point of the Better Auth handler. */
export const AUTH_BASE_PATH = "/api/auth";

/** Where an MCP client's OAuth sign-in sends somebody who is not signed in yet. */
export const OAUTH_LOGIN_PATH = "/oauth/sign-in";

/** Where they approve (or refuse) the client, and choose read-only. */
export const OAUTH_CONSENT_PATH = "/oauth/consent";

/** The scope a read-only OAuth grant carries (MCP access spec §3.4). */
export const READ_ONLY_SCOPE = "read_only";

/** 30 days. A session row lives this long unless it is refreshed or revoked. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Rolling refresh: an active session slides forward, an idle one expires. */
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

/**
 * True when database sessions can exist: `AUTH_SECRET` signs the session
 * cookie, and that is all Better Auth needs to hold a session.
 *
 * Deliberately separate from {@link hasGoogleEnv}. The old `hasAuthEnv()`
 * required both, which after Phase 4 would mean no sessions at all without a
 * Google client — and the E2E suite needs exactly that: a test-only secret, no
 * Google, real signed cookies minted against seeded rows.
 */
export function hasSessionEnv(): boolean {
  return Boolean(process.env.AUTH_SECRET);
}

/** True when the Google OAuth client is configured and sign-in can start. */
export function hasGoogleEnv(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export type AuthInstance = ReturnType<typeof createAuth>;

let cached: AuthInstance | null = null;
let cachedKey = "";

/**
 * The configured instance, or `null` when no session can exist.
 *
 * Async because the Drizzle adapter needs the handle synchronously and
 * `getDb()` is a promise (PGlite migrates and seeds on first use). Memoized per
 * env fingerprint *and* substrate — a test that switches `DATABASE_URL` must
 * not keep an instance pointed at the previous database.
 *
 * Built lazily: constructing at module load would make serving the catalogue
 * depend on credentials it does not need.
 */
export async function getAuth(): Promise<AuthInstance | null> {
  if (!hasSessionEnv()) return null;
  const key = `${dataSubstrate()}|${envFingerprint()}`;
  if (!cached || cachedKey !== key) {
    cached = createAuth(await getDb());
    cachedKey = key;
  }
  return cached;
}

export function createAuth(db: Db) {
  const secret = process.env.AUTH_SECRET || "";
  const domain = allowedEmailDomain();
  const namedExceptions = allowedEmails().length > 0;

  return betterAuth({
    secret,
    baseURL: authBaseUrl(),
    basePath: AUTH_BASE_PATH,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    // Registered only when the client exists, so `/sign-in/social` answers a
    // clean "not configured" instead of starting a handshake that cannot
    // finish. The header already renders that state (`sign-in-client.ts`).
    socialProviders: hasGoogleEnv()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
            // UI hint + Better Auth's `hd` claim check. Not the control.
            //
            // Dropped entirely once AUTH_ALLOWED_EMAILS names anybody, because
            // `hd` is not only a hint to Google: Better Auth verifies the claim
            // on the returned id token, and a personal account carries no `hd`
            // at all. Left on, it would refuse every named exception before
            // this app's own check ran — the allowlist would look configured
            // and do nothing. The picker gets wider; the two enforcement
            // points below do not move.
            ...(namedExceptions ? {} : { hd: domain }),
          },
        }
      : {},
    session: {
      expiresIn: SESSION_MAX_AGE_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      // Cookie cache deliberately off (spec §3.4): a cached session is a
      // stale role, and "the change lands on their next request" is the goal.
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Enforcement #1: refuse to even create a user outside the domain.
            if (!isAllowedEmail(user.email)) return false;
            // A blocked address (auth spec amendment 2026-09-25): refused
            // before any row exists, like the domain. Thrown rather than
            // `false` so the OAuth callback can say *why* — its error redirect
            // carries this code, and the auth route sends it to `/auth/blocked`.
            // The floor is never blocked (`blocked-sign-in.ts`).
            if (await isSignUpBlocked(user.email, db)) throw emailBlockedError();
            // The floor (§3.4). No user row exists before the first sign-in,
            // so there is no admin to promote anybody: the listed address
            // arrives already a super admin, and that is how the first one
            // comes to exist.
            if (isSuperAdminFloor(user.email)) {
              return { data: { ...user, role: "super_admin" } };
            }
          },
        },
      },
    },
    hooks: {
      after: createAuthMiddleware(async (ctx) => {
        const newSession = ctx.context.newSession;
        if (!newSession) return;
        // Enforcement #2. Belt and braces: an address that is somehow already a
        // row — a domain reconfigured after the fact, a restored backup — does
        // not get to carry a session out of here.
        if (!isAllowedEmail(newSession.user.email)) {
          throw ctx.redirect(DOMAIN_REJECTED_PATH);
        }
      }),
    },
    plugins: [
      admin({
        ac,
        roles,
        defaultRole: "user",
        // Only a director may reach `set-role` / `ban-user`. The permission
        // declaration says the same thing; this is the plugin's own guard on
        // impersonating an administrator, which v5 never does anyway.
        adminRoles: ["super_admin"],
      }),
      // "Sign in with MakerLab" for MCP clients (MCP access spec §3.4): the
      // OAuth authorization server, dynamic client registration and the
      // discovery documents, served under /api/auth and re-served at the
      // origin's /.well-known paths by `app/.well-known/*`. PKCE is required;
      // every authorization goes through the consent page, which the auth
      // route enforces (`forceConsent` in `app/api/auth/[...all]/route.ts`).
      mcp({
        loginPage: OAUTH_LOGIN_PATH,
        resource: `${authBaseUrl()}/api/mcp/signed-in`,
        oidcConfig: {
          loginPage: OAUTH_LOGIN_PATH,
          consentPage: OAUTH_CONSENT_PATH,
          requirePKCE: true,
          // Chosen on the consent page, never granted more than the role.
          scopes: [READ_ONLY_SCOPE],
        },
      }),
      // Development-only sign-in (auth spec amendment 2026-09-24): one
      // server-only endpoint with no URL, inert unless `next dev` with
      // `DEV_AUTO_SIGN_IN=1` off Vercel. See `dev-sign-in-plugin.ts`.
      devSignInPlugin(),
      // Must stay last: it wraps the response so Next writes the cookies.
      nextCookies(),
    ],
  });
}

/** Reset the memoized instance. Test-only; production never needs it. */
export function resetAuthForTests(): void {
  cached = null;
  cachedKey = "";
}

/**
 * Absolute origin the OAuth redirect returns to. Vercel supplies
 * `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`; `AUTH_BASE_URL` overrides both
 * (needed for a custom domain, and for local development).
 */
export function authBaseUrl(): string {
  const explicit = (process.env.AUTH_BASE_URL || "").trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "";
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

function envFingerprint(): string {
  return [
    process.env.AUTH_SECRET,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.AUTH_BASE_URL,
    process.env.AUTH_ALLOWED_EMAIL_DOMAIN,
    process.env.AUTH_SUPER_ADMIN_EMAILS,
  ].join(" ");
}
