// @vitest-environment node
import { createAuth } from "../../src/lib/auth/config";
import { getDb, resetDbForTests } from "../../src/lib/db/client";
import {
  BETTER_AUTH_SESSION_COOKIE,
  seedUser,
  signInAs,
  signInAsNew,
} from "./session";

/**
 * The helper's own self-test, and the most load-bearing test in Phase 4.
 *
 * Every later test that asserts "an admin may do X" trusts that a cookie this
 * helper minted is a cookie Better Auth accepts. That is a claim about an
 * undocumented signing format inside a dependency, so it is asserted here
 * against the real `auth.api.getSession()` rather than assumed.
 */

const SECRET = "session-helper-test-secret";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", SECRET);
});

afterEach(() => {
  resetDbForTests();
});

async function auth() {
  return createAuth(await getDb());
}

async function sessionFor(cookie: string) {
  const instance = await auth();
  return instance.api.getSession({ headers: new Headers({ cookie }) });
}

describe("signInAs", () => {
  it("mints a cookie a real Better Auth instance accepts", async () => {
    const signedIn = await signInAsNew({ role: "admin", name: "Niti" });

    const result = await sessionFor(signedIn.cookie);

    expect(result).not.toBeNull();
    expect(result!.user.id).toBe(signedIn.user.id);
    expect(result!.user.email).toBe(signedIn.user.email);
    expect(result!.user.role).toBe("admin");
  });

  it("names the cookie the way Better Auth names it on an http origin", () => {
    expect(BETTER_AUTH_SESSION_COOKIE).toBe("better-auth.session_token");
  });

  it("is rejected when signed with a different secret", async () => {
    // The whole point of the signature: a token alone is not a session.
    const person = await seedUser();
    const forged = await signInAs(person, { secret: "not-the-secret" });

    expect(await sessionFor(forged.cookie)).toBeNull();
  });

  it("is rejected when the signature is tampered with", async () => {
    const signedIn = await signInAsNew();
    const tampered = signedIn.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));

    expect(await sessionFor(tampered)).toBeNull();
  });

  it("is rejected once the session row has expired", async () => {
    const signedIn = await signInAsNew({}, { expiresInSeconds: -60 });

    expect(await sessionFor(signedIn.cookie)).toBeNull();
  });

  it("reports a banned user's ban to the caller", async () => {
    // `getSession` still resolves; refusing a banned user is `resolveIdentity`'s
    // job, and this is the field it reads.
    const signedIn = await signInAsNew({ banned: true, banReason: "spam" });

    const result = await sessionFor(signedIn.cookie);
    expect(result?.user.banned).toBe(true);
  });

  it("refuses to mint a cookie with no secret configured", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    const person = await seedUser();
    await expect(signInAs(person)).rejects.toThrow(/AUTH_SECRET/);
  });
});
