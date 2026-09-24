/**
 * Better Auth's signed-cookie format, on its own, with no imports.
 *
 * Kept apart from `session.ts` because Playwright's process loads it: `session.ts`
 * reaches `src/lib/db/client` and `src/lib/auth/config` (which is `server-only`),
 * and an E2E spec must not drag a Next server module into the test runner just
 * to build a cookie string.
 *
 * The format is taken from the library, not guessed. `better-call`'s
 * `signCookieValue` (see `node_modules/better-call/dist/crypto.mjs`) builds
 * `encodeURIComponent(value + "." + btoa(HMAC-SHA256(secret, value)))`, and
 * `better-auth/dist/cookies/index.mjs` names the cookie `<prefix>.session_token`,
 * adding a `__Secure-` prefix only when the base URL is https. The test and E2E
 * base URLs are http, so the name is the bare one.
 *
 * It is reimplemented rather than imported because it is not a public export of
 * either package, and a test helper that reaches into a dependency's internals
 * breaks on a patch release. `test/utils/session.test.ts` proves the format
 * against a real `auth.api.getSession()`; that is what licenses its use here.
 */

/** The cookie Better Auth reads on an http origin. */
export const BETTER_AUTH_SESSION_COOKIE = "better-auth.session_token";

/** `encodeURIComponent(value + "." + base64(HMAC-SHA256(secret, value)))`. */
export async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return encodeURIComponent(`${value}.${base64}`);
}
