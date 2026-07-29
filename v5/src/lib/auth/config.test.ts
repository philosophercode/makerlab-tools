/**
 * @vitest-environment node
 *
 * Node, not jsdom: Better Auth encrypts the provider's OAuth tokens through
 * `jose`, which checks `plaintext instanceof Uint8Array` — and jsdom's realm
 * makes that check fail on a perfectly good Uint8Array. This route only ever
 * runs on the server anyway.
 */
import { http, HttpResponse } from "msw";

import { server } from "../../../test/msw/server";
import {
  AUTH_BASE_PATH,
  DOMAIN_REJECTED_PATH,
  createAuth,
  getAuth,
  hasAuthEnv,
  resetAuthForTests,
} from "@/lib/auth/config";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth/session-cookie";

// No live OAuth (Article 3). Google's token endpoint is mocked by MSW and the
// id_token is a hand-built JWT — the Google provider decodes it rather than
// verifying its signature on the authorization-code path, so a forged one is
// enough to drive the whole callback.

const SECRET = "config-test-secret";
const ORIGIN = "http://localhost:3000";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

function stubAuthEnv(overrides: Record<string, string> = {}) {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("AUTH_BASE_URL", ORIGIN);
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

function b64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** A Google id_token. Signature is decorative — the provider only decodes it. */
function idToken(claims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    iat: now,
    exp: now + 3600,
    email_verified: true,
    ...claims,
  };
  return `${b64url(JSON.stringify({ alg: "RS256", kid: "test" }))}.${b64url(
    JSON.stringify(payload)
  )}.signature`;
}

/** Mock Google's token exchange to return `token` for any code. */
function mockGoogleToken(token: string) {
  server.use(
    http.post("https://oauth2.googleapis.com/token", () =>
      HttpResponse.json({
        access_token: "google-access-token",
        id_token: token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid email profile",
      })
    )
  );
}

/** Collect every `set-cookie` into a single `Cookie` request header. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

function setCookieFor(res: Response, name: string): string | undefined {
  return res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
}

/**
 * Run the full authorization-code flow and return the callback response.
 * Step 1 gets the state cookie + state param; step 2 is the callback Google
 * would redirect the browser to.
 */
async function signInThroughGoogle(email: string, name = "Ada Lovelace") {
  const auth = createAuth();

  const start = await auth.handler(
    new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "google", callbackURL: "/tools" }),
    })
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const authorizeUrl = new URL(url);
  const state = authorizeUrl.searchParams.get("state");
  expect(state).toBeTruthy();

  mockGoogleToken(
    idToken({
      sub: "google-sub-42",
      email,
      name,
      hd: email.split("@")[1],
      picture: "https://example.com/a.png",
    })
  );

  const callback = await auth.handler(
    new Request(
      `${ORIGIN}${AUTH_BASE_PATH}/callback/google?code=auth-code&state=${state}`,
      { headers: { cookie: cookieHeader(start), origin: ORIGIN } }
    )
  );

  return { authorizeUrl, callback };
}

beforeEach(() => {
  resetAuthForTests();
});

describe("hasAuthEnv / getAuth", () => {
  it("is false and yields no instance when Google is not configured", () => {
    expect(hasAuthEnv()).toBe(false);
    expect(getAuth()).toBeNull();
  });

  it("still requires every variable — a partial config is not configured", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
    expect(hasAuthEnv()).toBe(false);
    expect(getAuth()).toBeNull();
  });

  it("builds and memoizes an instance once fully configured", () => {
    stubAuthEnv();
    const first = getAuth();
    expect(first).not.toBeNull();
    expect(getAuth()).toBe(first);
  });

  it("rebuilds when the configuration changes", () => {
    stubAuthEnv();
    const first = getAuth();
    vi.stubEnv("GOOGLE_CLIENT_ID", "a-different-client");
    expect(getAuth()).not.toBe(first);
  });
});

describe("Google authorization URL", () => {
  it("sends hd so the account picker is narrowed to the institution", async () => {
    stubAuthEnv();
    const { authorizeUrl } = await signInThroughGoogle("student@cornell.edu");
    expect(authorizeUrl.origin + authorizeUrl.pathname).toContain(
      "accounts.google.com"
    );
    expect(authorizeUrl.searchParams.get("hd")).toBe("cornell.edu");
    expect(authorizeUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
  });

  it("uses the configured domain, not a hardcoded one", async () => {
    stubAuthEnv({ AUTH_ALLOWED_EMAIL_DOMAIN: "example.edu" });
    const { authorizeUrl } = await signInThroughGoogle("student@example.edu");
    expect(authorizeUrl.searchParams.get("hd")).toBe("example.edu");
  });
});

describe("sign-in callback — institutional account", () => {
  it("sets a signed session cookie carrying sub, email, and name", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("student@cornell.edu");

    const cookie = setCookieFor(callback, SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");

    const token = cookie!.split(";")[0].split("=")[1];
    const payload = await verifySessionToken(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.email).toBe("student@cornell.edu");
    expect(payload!.name).toBe("Ada Lovelace");
    expect(payload!.sub).toBeTruthy();
  });

  it("issues a cookie no other secret can verify", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("student@cornell.edu");
    const token = setCookieFor(callback, SESSION_COOKIE_NAME)!
      .split(";")[0]
      .split("=")[1];
    expect(await verifySessionToken(token, "not-the-secret")).toBeNull();
  });
});

describe("sign-in callback — non-institutional account", () => {
  it("refuses the domain server-side and never issues a session cookie", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("someone@gmail.com");

    const cookie = setCookieFor(callback, SESSION_COOKIE_NAME);
    // Either no cookie at all, or an explicitly cleared one — never a usable
    // session. `hd` alone would not have stopped this; the server-side check did.
    if (cookie) {
      const token = cookie.split(";")[0].split("=")[1];
      expect(await verifySessionToken(token, SECRET)).toBeNull();
    }
  });

  it("redirects rather than dead-ending on a stack trace", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("someone@gmail.com");
    expect([302, 303, 307].includes(callback.status)).toBe(true);
    expect(callback.headers.get("location")).toBeTruthy();
  });
});

describe("exports", () => {
  it("names the rejected-domain path the header UI links to", () => {
    expect(DOMAIN_REJECTED_PATH).toBe("/auth/rejected");
    expect(AUTH_BASE_PATH).toBe("/api/auth");
  });
});
