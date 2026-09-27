import type { BrowserContext } from "@playwright/test";

import {
  BETTER_AUTH_SESSION_COOKIE,
  signCookieValue,
} from "../../test/utils/better-auth-cookie";

/**
 * Being somebody in an E2E run, without Google.
 *
 * Sessions are database rows since Phase 4, so the demo seed ships an account
 * per role with a known session token (`src/lib/db/demo-seed.ts`), the
 * Playwright server boots with a test-only `AUTH_SECRET`, and this signs a
 * cookie for one of them exactly the way Better Auth would. Nothing is
 * intercepted: the real `/api/identity` reads the real session row.
 *
 * It imports only `test/utils/better-auth-cookie.ts`, which has no imports of
 * its own — deliberately, so an E2E spec never drags a `server-only` module
 * into the Playwright process.
 */

/** Must match `AUTH_SECRET` in playwright.config.ts's `webServer.env`. */
export const E2E_AUTH_SECRET = "e2e-only-secret-not-used-anywhere-else";

export const E2E_BASE_URL = "http://localhost:3100";

/** Put a properly signed session cookie for a demo account in the browser. */
export async function signIn(
  context: BrowserContext,
  account: { sessionToken: string },
  baseURL?: string
): Promise<void> {
  await context.addCookies([
    {
      name: BETTER_AUTH_SESSION_COOKIE,
      value: await signCookieValue(account.sessionToken, E2E_AUTH_SECRET),
      url: baseURL ?? E2E_BASE_URL,
    },
  ]);
}

export { BETTER_AUTH_SESSION_COOKIE, signCookieValue };
