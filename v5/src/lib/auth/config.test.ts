/**
 * @vitest-environment node
 *
 * Node, not jsdom: Better Auth encrypts the provider's OAuth tokens through
 * `jose`, which checks `plaintext instanceof Uint8Array` — and jsdom's realm
 * makes that check fail on a perfectly good Uint8Array. PGlite needs node too.
 * This module only ever runs on the server anyway.
 */
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";

import { server } from "../../../test/msw/server";
import {
  AUTH_BASE_PATH,
  DOMAIN_REJECTED_PATH,
  createAuth,
  getAuth,
  hasGoogleEnv,
  hasSessionEnv,
  resetAuthForTests,
} from "@/lib/auth/config";
import { addPersonAccount } from "@/lib/data/user-add";
import { updateUserName } from "@/lib/data/users";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { account, session, user } from "@/lib/db/schema/index";

// No live OAuth (Article 3). Google's token endpoint is mocked by MSW and the
// id_token is a hand-built JWT — the Google provider decodes it rather than
// verifying its signature on the authorization-code path, so a forged one is
// enough to drive the whole callback. Every row lands in PGlite.

const SECRET = "config-test-secret";
const ORIGIN = "http://localhost:3000";
const CLIENT_ID = "test-client-id.apps.googleusercontent.com";

function stubSessionEnv(overrides: Record<string, string> = {}) {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("AUTH_BASE_URL", ORIGIN);
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
}

function stubAuthEnv(overrides: Record<string, string> = {}) {
  stubSessionEnv();
  vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-client-secret");
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

let sub = 0;

/**
 * Run the full authorization-code flow and return the callback response.
 * Step 1 gets the state cookie + state param; step 2 is the callback Google
 * would redirect the browser to.
 */
async function signInThroughGoogle(email: string, name = "Ada Lovelace") {
  const auth = createAuth(await getDb());

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

  sub += 1;
  mockGoogleToken(
    idToken({
      sub: `google-sub-${sub}`,
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

async function userRow(email: string) {
  const db = await getDb();
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row;
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

describe("hasSessionEnv / hasGoogleEnv / getAuth", () => {
  it("has no instance with nothing configured", async () => {
    expect(hasSessionEnv()).toBe(false);
    expect(hasGoogleEnv()).toBe(false);
    expect(await getAuth()).toBeNull();
  });

  it("builds an instance from AUTH_SECRET alone", async () => {
    // The split that Phase 4 needed: database sessions require a secret and
    // nothing else, and the E2E suite runs exactly this way — real signed
    // cookies against seeded rows, with Google deliberately unconfigured.
    stubSessionEnv();
    expect(hasSessionEnv()).toBe(true);
    expect(hasGoogleEnv()).toBe(false);
    expect(await getAuth()).not.toBeNull();
  });

  it("needs both Google variables before it calls Google configured", () => {
    stubSessionEnv();
    vi.stubEnv("GOOGLE_CLIENT_ID", CLIENT_ID);
    expect(hasGoogleEnv()).toBe(false);
  });

  it("memoizes the instance and rebuilds when the configuration changes", async () => {
    stubAuthEnv();
    const first = await getAuth();
    expect(await getAuth()).toBe(first);

    vi.stubEnv("GOOGLE_CLIENT_ID", "a-different-client");
    expect(await getAuth()).not.toBe(first);
  });

  it("rebuilds when the data substrate changes", async () => {
    // A memo keyed only on env would hand back an instance still pointed at
    // the previous database.
    stubAuthEnv();
    const first = await getAuth();
    vi.stubEnv("DATABASE_URL", "postgres://example.invalid/db");
    expect(await getAuth()).not.toBe(first);
  });

  it("refuses social sign-in when Google is not configured", async () => {
    stubSessionEnv();
    const { POST } = await import("@/app/api/auth/[...all]/route");
    const res = await POST(
      new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" },
        body: JSON.stringify({ provider: "google", callbackURL: "/" }),
      })
    );
    // 503 is what the header renders as "sign-in is not set up here".
    expect(res.status).toBe(503);
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
  it("writes a user row with the default role and a session row", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("student@cornell.edu");

    const row = await userRow("student@cornell.edu");
    expect(row).toBeDefined();
    expect(row.role).toBe("user");
    expect(row.name).toBe("Ada Lovelace");

    const db = await getDb();
    const sessions = await db.select().from(session).where(eq(session.userId, row.id));
    expect(sessions).toHaveLength(1);
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

    const cookie = setCookieFor(callback, "better-auth.session_token");
    expect(cookie).toBeDefined();
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("no longer mints the retired makerlab.identity cookie", async () => {
    // The stateless cookie *was* the session until Phase 4. Nothing reads it
    // now, and leaving one behind would be a second, un-revocable identity.
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("student@cornell.edu");
    expect(setCookieFor(callback, "makerlab.identity")).toBeUndefined();
  });

  it("creates an AUTH_SUPER_ADMIN_EMAILS address as super_admin", async () => {
    // The bootstrap: no user row exists before the first sign-in, so there is
    // no admin to promote anybody. The floor is how the first one comes to be.
    stubAuthEnv({ AUTH_SUPER_ADMIN_EMAILS: "ies22@cornell.edu" });
    await signInThroughGoogle("ies22@cornell.edu", "Isaac S");

    expect((await userRow("ies22@cornell.edu")).role).toBe("super_admin");
  });

  it("does not raise anyone else to super_admin", async () => {
    stubAuthEnv({ AUTH_SUPER_ADMIN_EMAILS: "ies22@cornell.edu" });
    await signInThroughGoogle("student@cornell.edu");

    expect((await userRow("student@cornell.edu")).role).toBe("user");
  });
});

describe("sign-in callback — non-institutional account", () => {
  it("creates no user row at all", async () => {
    // Enforcement #1, in `databaseHooks.user.create.before`. `hd` alone would
    // not have stopped this — it only narrows Google's account picker.
    stubAuthEnv();
    await signInThroughGoogle("someone@gmail.com");

    expect(await userRow("someone@gmail.com")).toBeUndefined();
  });

  it("issues no usable session", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("someone@gmail.com");

    const cookie = setCookieFor(callback, "better-auth.session_token");
    if (cookie) {
      // Either no cookie at all, or an explicitly cleared one.
      expect(cookie.split(";")[0].split("=")[1]).toBe("");
    }
    // No user row was created, so no session can point at one. (The demo seed
    // ships three sessions of its own; none of them is this person's.)
    const db = await getDb();
    const sessions = await db.select().from(session);
    const users = await db.select().from(user);
    const emails = new Map(users.map((row) => [row.id, row.email]));
    expect(
      sessions.filter((row) => emails.get(row.userId) === "someone@gmail.com")
    ).toHaveLength(0);
  });

  it("redirects rather than dead-ending on a stack trace", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("someone@gmail.com");
    expect([302, 303, 307].includes(callback.status)).toBe(true);
    expect(callback.headers.get("location")).toBeTruthy();
  });
});

describe("sign-in callback — somebody a super admin added first", () => {
  // The People page's "Add person" (`lib/data/user-add.ts`) writes a `user`
  // row with no `account`. Their first Google sign-in must attach to that row
  // — same id, same role, same title — not fail and not create a second one.

  async function preAdd(overrides: Partial<Parameters<typeof addPersonAccount>[0]> = {}) {
    const result = await addPersonAccount({
      email: "luis@cornell.edu",
      name: "luis@cornell.edu",
      role: "admin",
      title: "Assistant Director",
      actorUserId: null,
      ...overrides,
    });
    if (!result.ok) throw new Error(result.error);
    return result.person;
  }

  it("links Google to the existing row, keeping its id, role and title", async () => {
    stubAuthEnv();
    const added = await preAdd();
    expect(added.firstSignedInAt).toBeNull();

    const { callback } = await signInThroughGoogle("luis@cornell.edu", "Luis Example");
    expect([302, 303, 307].includes(callback.status)).toBe(true);
    expect(callback.headers.get("location") ?? "").not.toContain("error");

    const db = await getDb();
    const rows = await db.select().from(user).where(eq(user.email, "luis@cornell.edu"));
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.id).toBe(added.id);
    expect(row.role).toBe("admin");
    expect(row.title).toBe("Assistant Director");
    // The placeholder name gives way to Google's, and Google verified the address.
    expect(row.name).toBe("Luis Example");
    expect(row.emailVerified).toBe(true);
    // No longer "Not signed in yet".
    expect(row.firstSignedInAt).toBeInstanceOf(Date);

    const accounts = await db.select().from(account).where(eq(account.userId, added.id));
    expect(accounts).toHaveLength(1);
    expect(accounts[0].providerId).toBe("google");

    const sessions = await db.select().from(session).where(eq(session.userId, added.id));
    expect(sessions).toHaveLength(1);
    expect(setCookieFor(callback, "better-auth.session_token")).toBeDefined();
  });

  it("signs the same person in again without a second account", async () => {
    stubAuthEnv();
    const added = await preAdd();
    await signInThroughGoogle("luis@cornell.edu", "Luis Example");
    const first = (await userRow("luis@cornell.edu")).firstSignedInAt;

    // Same Google subject as the first time: the account is found, not relinked.
    sub -= 1;
    await signInThroughGoogle("luis@cornell.edu", "Luis Example");

    const db = await getDb();
    expect(await db.select().from(account).where(eq(account.userId, added.id))).toHaveLength(1);
    expect((await userRow("luis@cornell.edu")).firstSignedInAt).toEqual(first);
  });

  it("keeps a name typed at Add person instead of Google's, and still takes the photo", async () => {
    stubAuthEnv();
    const added = await preAdd({ name: "Luis Typed" });

    await signInThroughGoogle("luis@cornell.edu", "Luis Example");

    const row = await userRow("luis@cornell.edu");
    expect(row.id).toBe(added.id);
    expect(row.name).toBe("Luis Typed");
    expect(row.image).toBe("https://example.com/a.png");
  });

  it("keeps a name a super admin corrected before the first sign-in", async () => {
    stubAuthEnv();
    const added = await preAdd();
    await updateUserName(added.id, "Luis Corrected");

    await signInThroughGoogle("luis@cornell.edu", "Luis Example");

    expect((await userRow("luis@cornell.edu")).name).toBe("Luis Corrected");
  });

  it("keeps a floor address a super admin when it was added as one", async () => {
    stubAuthEnv({ AUTH_SUPER_ADMIN_EMAILS: "luis@cornell.edu" });
    const added = await preAdd({ role: "super_admin", title: "Director" });
    await signInThroughGoogle("luis@cornell.edu", "Luis Example");

    const row = await userRow("luis@cornell.edu");
    expect(row.id).toBe(added.id);
    expect(row.role).toBe("super_admin");
    expect(row.title).toBe("Director");
  });

  it("does not link a Google account whose address Google has not verified", async () => {
    stubAuthEnv();
    const added = await preAdd();
    const auth = createAuth(await getDb());

    const start = await auth.handler(
      new Request(`${ORIGIN}${AUTH_BASE_PATH}/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ provider: "google", callbackURL: "/tools" }),
      })
    );
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state");
    mockGoogleToken(
      idToken({ sub: "google-sub-unverified", email: "luis@cornell.edu", name: "Mallory", hd: "cornell.edu", email_verified: false })
    );
    const callback = await auth.handler(
      new Request(`${ORIGIN}${AUTH_BASE_PATH}/callback/google?code=auth-code&state=${state}`, {
        headers: { cookie: cookieHeader(start), origin: ORIGIN },
      })
    );
    expect(callback.headers.get("location") ?? "").toContain("error");

    const db = await getDb();
    expect(await db.select().from(account).where(eq(account.userId, added.id))).toHaveLength(0);
    expect(await db.select().from(session).where(eq(session.userId, added.id))).toHaveLength(0);
    const row = await userRow("luis@cornell.edu");
    expect(row.name).toBe("luis@cornell.edu");
    expect(row.firstSignedInAt).toBeNull();
  });

  it("stamps nothing for somebody who signed up the ordinary way", async () => {
    stubAuthEnv();
    await signInThroughGoogle("student@cornell.edu");
    const row = await userRow("student@cornell.edu");
    // The column default: created at their first sign-in, so that is it.
    expect(row.firstSignedInAt).toBeInstanceOf(Date);
  });
});

describe("sign-in callback — a name somebody edited", () => {
  it("takes Google's name at sign-up", async () => {
    stubAuthEnv();
    await signInThroughGoogle("ada@cornell.edu", "Ada Lovelace");
    expect((await userRow("ada@cornell.edu")).name).toBe("Ada Lovelace");
  });

  it("is not overwritten by Google at a later sign-in", async () => {
    stubAuthEnv();
    await signInThroughGoogle("ada@cornell.edu", "Ada Lovelace");
    const row = await userRow("ada@cornell.edu");
    await updateUserName(row.id, "Ada K. Lovelace");

    // Same Google subject: the linked account is found, and Google still says "Ada Lovelace".
    sub -= 1;
    await signInThroughGoogle("ada@cornell.edu", "Ada Lovelace");

    const db = await getDb();
    expect(await db.select().from(account).where(eq(account.userId, row.id))).toHaveLength(1);
    expect((await userRow("ada@cornell.edu")).name).toBe("Ada K. Lovelace");
  });

  it("cannot be changed through Better Auth's own update-user endpoint", async () => {
    stubAuthEnv();
    const { callback } = await signInThroughGoogle("ada@cornell.edu", "Ada Lovelace");
    const auth = createAuth(await getDb());

    const res = await auth.handler(
      new Request(`${ORIGIN}${AUTH_BASE_PATH}/update-user`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, cookie: cookieHeader(callback) },
        body: JSON.stringify({ name: "Not Audited" }),
      })
    );

    expect(res.status).toBe(404);
    expect((await userRow("ada@cornell.edu")).name).toBe("Ada Lovelace");
  });
});

describe("exports", () => {
  it("names the rejected-domain path the header UI links to", () => {
    expect(DOMAIN_REJECTED_PATH).toBe("/auth/rejected");
    expect(AUTH_BASE_PATH).toBe("/api/auth");
  });
});
