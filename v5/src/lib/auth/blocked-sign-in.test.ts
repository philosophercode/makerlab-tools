// @vitest-environment node
/**
 * A blocked address cannot sign up (auth spec amendment 2026-09-25, "Remove a
 * person, and block an address").
 *
 * The refusal lives in `databaseHooks.user.create.before`, so it is exercised
 * here through the one sign-in path the suite can drive end to end without
 * Google: development sign-in, which runs Better Auth's own create hook
 * (`dev-sign-in-plugin.ts`). Real Better Auth, real PGlite rows.
 */
import { eq } from "drizzle-orm";
import { isAPIError } from "better-auth/api";

import { GET } from "@/app/api/dev/sign-in/route";
import { getAuth, resetAuthForTests } from "@/lib/auth/config";
import { resolveIdentity } from "@/lib/auth/identity";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { blockedEmails, user } from "@/lib/db/schema/index";
import { insertBlockedEmail, unblockEmail } from "@/lib/data/blocked-emails";
import { removeUserAccount } from "@/lib/data/user-removal";
import { seedUser } from "../../../test/utils/session";
import {
  BLOCKED_SIGN_IN_PATH,
  EMAIL_BLOCKED_CODE,
  emailBlockedError,
  isSignUpBlocked,
  redirectBlockedSignIn,
} from "./blocked-sign-in";

let counter = 0;
function uniqueEmail(local = "person") {
  counter += 1;
  return `${local}-${counter}-${Date.now()}@cornell.edu`;
}

function signIn(email: string) {
  return GET(
    new Request(`http://localhost:3000/api/dev/sign-in?as=${encodeURIComponent(email)}`, {
      headers: { host: "localhost:3000", "user-agent": "vitest" },
    })
  );
}

async function identityFor(res: Response) {
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return resolveIdentity(new Request("http://localhost:3000/api/identity", { headers: { cookie } }));
}

async function rowFor(email: string) {
  const db = await getDb();
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row ?? null;
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "blocked-sign-in-test-secret");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEV_AUTO_SIGN_IN", "1");
  vi.stubEnv("DEV_AUTO_SIGN_IN_EMAIL", "");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
  vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "");
  resetAuthForTests();
  const db = await getDb();
  await db.delete(blockedEmails);
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
  resetDbForTests();
});

describe("signing up with a blocked address", () => {
  it("is refused, and no account is created", async () => {
    const email = uniqueEmail("blocked");
    await insertBlockedEmail({ email, blockedBy: null });

    const res = await signIn(email);

    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await rowFor(email)).toBeNull();
  });

  it("matches the address however it is cased", async () => {
    const email = uniqueEmail("cased");
    await insertBlockedEmail({ email: email.toUpperCase(), blockedBy: null });

    expect((await signIn(email)).status).toBe(404);
    expect(await rowFor(email)).toBeNull();
  });

  it("works again once the address is unblocked — as a new account with the default role", async () => {
    const email = uniqueEmail("forgiven");
    await insertBlockedEmail({ email, blockedBy: null });
    expect((await signIn(email)).status).toBe(404);

    await unblockEmail({ email, actorUserId: null });

    const res = await signIn(email);
    expect(res.status).toBe(303);
    expect((await identityFor(res)).role).toBe("user");
  });

  it("never refuses a floor address — the floor outranks the list", async () => {
    const email = uniqueEmail("founder");
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", email);
    resetAuthForTests();
    await insertBlockedEmail({ email, blockedBy: null });

    expect(await isSignUpBlocked(email)).toBe(false);
    const res = await signIn(email);
    expect(res.status).toBe(303);
    expect((await identityFor(res)).role).toBe("super_admin");
  });
});

describe("a removed person signing in again", () => {
  it("becomes a fresh account with the default role when not blocked", async () => {
    const email = uniqueEmail("returning");
    const before = await seedUser({ email, role: "admin" });
    await removeUserAccount({ userId: before.id, actorUserId: null });

    const res = await signIn(email);
    expect(res.status).toBe(303);
    const identity = await identityFor(res);
    expect(identity.role).toBe("user");
    expect(identity.userId).not.toBe(before.id);
  });

  it("is refused when the removal blocked them", async () => {
    const email = uniqueEmail("gone");
    const before = await seedUser({ email, role: "user" });
    await removeUserAccount({ userId: before.id, actorUserId: null, block: { reason: "Misuse" } });

    expect((await signIn(email)).status).toBe(404);
    expect(await rowFor(email)).toBeNull();
  });
});

describe("the OAuth callback's error redirect", () => {
  it("is what Google sign-in's own user creation throws for a blocked address", async () => {
    // The call `handleOAuthUserInfo` makes for a first Google sign-in, with
    // the create hook in front of it.
    const email = uniqueEmail("google");
    await insertBlockedEmail({ email, blockedBy: null });
    const auth = await getAuth();
    const context = await auth!.$context;

    const attempt = context.internalAdapter.createOAuthUser(
      { email, name: "Goo Gle", emailVerified: true },
      { accountId: "google-sub-1", providerId: "google" }
    );

    await expect(attempt).rejects.toMatchObject({ message: EMAIL_BLOCKED_CODE });
    expect(await rowFor(email)).toBeNull();
  });

  it("carries the code Better Auth turns into ?error=", () => {
    // `handleOAuthUserInfo` catches an APIError from the create hook and uses
    // its message as the error redirect's `error` parameter.
    const error = emailBlockedError();
    expect(isAPIError(error)).toBe(true);
    expect(error.message).toBe(EMAIL_BLOCKED_CODE);
  });

  it("is sent to the blocked page, cookies kept", () => {
    const headers = new Headers({ location: "http://localhost:3000/api/auth/error?error=email_blocked" });
    headers.append("set-cookie", "better-auth.state=; Max-Age=0");
    const rewritten = redirectBlockedSignIn(new Response(null, { status: 302, headers }));

    expect(rewritten.status).toBe(302);
    expect(rewritten.headers.get("location")).toBe(BLOCKED_SIGN_IN_PATH);
    expect(rewritten.headers.getSetCookie()).toEqual(["better-auth.state=; Max-Age=0"]);
  });

  it("leaves every other response alone", () => {
    const other = new Response(null, {
      status: 302,
      headers: { location: "http://localhost:3000/api/auth/error?error=access_denied" },
    });
    expect(redirectBlockedSignIn(other)).toBe(other);
    const ok = Response.json({ ok: true });
    expect(redirectBlockedSignIn(ok)).toBe(ok);
  });
});
