// @vitest-environment node
/**
 * `GET /api/dev/sign-in` — development-only sign-in (auth spec amendment
 * 2026-09-24).
 *
 * Real Better Auth, real PGlite rows, the real `resolveIdentity`: the happy
 * path proves the cookie the route sets is one the app recognises, and each
 * guard is shown to refuse on its own with a 404.
 */
import { eq } from "drizzle-orm";

import { GET } from "@/app/api/dev/sign-in/route";
import { GET as identityGET } from "@/app/api/identity/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { resolveIdentity } from "@/lib/auth/identity";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { auditEvents, session, user } from "@/lib/db/schema/index";
import { seedUser } from "../../../../../test/utils/session";

const AUTH_SECRET = "dev-sign-in-test-secret";

let counter = 0;
function uniqueEmail(local = "person") {
  counter += 1;
  return `${local}-${counter}-${Date.now()}@cornell.edu`;
}

function devRequest(
  query: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost:3000/api/dev/sign-in${query}`, {
    headers: { host: "localhost:3000", "user-agent": "vitest", ...headers },
  });
}

/** The `name=value` pairs a browser would send back. */
function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

async function identityFor(res: Response) {
  const req = new Request("http://localhost:3000/api/identity", {
    headers: { cookie: cookieFrom(res) },
  });
  return resolveIdentity(req);
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEV_AUTO_SIGN_IN", "1");
  vi.stubEnv("DEV_AUTO_SIGN_IN_EMAIL", "");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  vi.stubEnv("AUTH_ALLOWED_EMAILS", "");
  vi.stubEnv("AUTH_ALLOWED_EMAIL_DOMAIN", "");
  resetAuthForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
  resetDbForTests();
});

describe("GET /api/dev/sign-in — happy path", () => {
  it("creates a student, a session resolveIdentity recognises, and redirects to next", async () => {
    const email = uniqueEmail("student");
    const res = await GET(devRequest(`?as=${encodeURIComponent(email)}&next=/admin`));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=");

    const identity = await identityFor(res);
    expect(identity.role).toBe("user");
    expect(identity.email).toBe(email);
    expect(identity.userId).toBeTruthy();

    const db = await getDb();
    const rows = await db.select().from(session).where(eq(session.userId, identity.userId!));
    expect(rows).toHaveLength(1);
  });

  it("gives a new address on AUTH_SUPER_ADMIN_EMAILS the super_admin role, stored", async () => {
    const email = uniqueEmail("director");
    vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", email);
    resetAuthForTests();

    const res = await GET(devRequest(`?as=${email}`));
    expect(res.status).toBe(303);

    const identity = await identityFor(res);
    expect(identity.role).toBe("super_admin");

    const db = await getDb();
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.role).toBe("super_admin");
  });

  it("signs an existing user in with their stored role, creating nothing", async () => {
    const existing = await seedUser({ email: uniqueEmail("maker"), role: "admin" });
    const res = await GET(devRequest(`?as=${existing.email}`));

    const identity = await identityFor(res);
    expect(identity.role).toBe("admin");
    expect(identity.userId).toBe(existing.id);
  });

  it("uses DEV_AUTO_SIGN_IN_EMAIL when `as` is absent, and defaults next to /", async () => {
    const email = uniqueEmail("owner");
    vi.stubEnv("DEV_AUTO_SIGN_IN_EMAIL", email);

    const res = await GET(devRequest(""));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect((await identityFor(res)).email).toBe(email);
  });

  it("answers 400 when there is neither `as` nor DEV_AUTO_SIGN_IN_EMAIL", async () => {
    const res = await GET(devRequest(""));
    expect(res.status).toBe(400);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("records auth.dev_sign_in in the audit trail", async () => {
    const email = uniqueEmail("audited");
    const res = await GET(devRequest(`?as=${email}`));
    const identity = await identityFor(res);

    const db = await getDb();
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.subjectId, identity.userId!));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "auth.dev_sign_in",
      actorUserId: identity.userId,
      subjectType: "user",
      detail: { created: true, role: "user" },
    });
  });
});

describe("GET /api/dev/sign-in — every guard refuses on its own with 404", () => {
  async function expectRefused(req: Request) {
    const res = await GET(req);
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
  }

  it("refuses in production even with DEV_AUTO_SIGN_IN=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expectRefused(devRequest(`?as=${uniqueEmail()}`));
  });

  it("refuses under test (anything but development)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await expectRefused(devRequest(`?as=${uniqueEmail()}`));
  });

  it("refuses on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    await expectRefused(devRequest(`?as=${uniqueEmail()}`));
  });

  it("refuses without the DEV_AUTO_SIGN_IN=1 opt-in", async () => {
    vi.stubEnv("DEV_AUTO_SIGN_IN", "");
    await expectRefused(devRequest(`?as=${uniqueEmail()}`));
    vi.stubEnv("DEV_AUTO_SIGN_IN", "true");
    await expectRefused(devRequest(`?as=${uniqueEmail()}`));
  });

  it("refuses a tunnel host such as ngrok", async () => {
    await expectRefused(
      devRequest(`?as=${uniqueEmail()}`, { host: "x.ngrok-free.dev" })
    );
  });

  it("refuses a tunnel that rewrites Host but forwards the visitor's address", async () => {
    await expectRefused(
      devRequest(`?as=${uniqueEmail()}`, { "x-forwarded-for": "198.51.100.4" })
    );
    await expectRefused(
      devRequest(`?as=${uniqueEmail()}`, { "x-forwarded-host": "x.ngrok-free.dev" })
    );
  });

  it("refuses an address outside the allowed domain, and creates no row", async () => {
    const email = `outsider-${Date.now()}@gmail.com`;
    await expectRefused(devRequest(`?as=${email}`));

    const db = await getDb();
    expect(await db.select().from(user).where(eq(user.email, email))).toHaveLength(0);
  });

  it("refuses a banned user", async () => {
    const banned = await seedUser({ email: uniqueEmail("banned"), banned: true });
    await expectRefused(devRequest(`?as=${banned.email}`));

    const db = await getDb();
    expect(await db.select().from(session).where(eq(session.userId, banned.id))).toHaveLength(0);
  });

  it("refuses when sign-in is not set up (no AUTH_SECRET)", async () => {
    vi.stubEnv("AUTH_SECRET", "");
    resetAuthForTests();
    await expectRefused(devRequest(`?as=${uniqueEmail()}`));
  });
});

describe("GET /api/dev/sign-in — next is never an open redirect", () => {
  it.each([
    ["an absolute URL", "https://evil.com/steal"],
    ["a protocol-relative URL", "//evil.com"],
    ["a backslash trick", "/\\evil.com"],
    ["a tab smuggled into //", "/\t/evil.com"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("sends %s to /", async (_label, next) => {
    const res = await GET(
      devRequest(`?as=${uniqueEmail()}&next=${encodeURIComponent(next)}`)
    );
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
  });

  it("keeps a same-origin path with its query", async () => {
    const res = await GET(
      devRequest(`?as=${uniqueEmail()}&next=${encodeURIComponent("/admin/users?q=a")}`)
    );
    expect(res.headers.get("location")).toBe("/admin/users?q=a");
  });
});

describe("GET /api/identity — the header's dev sign-in hint", () => {
  function identityRequest(host = "localhost:3000") {
    return new Request("http://localhost:3000/api/identity", { headers: { host } });
  }

  it("tells an anonymous local caller that dev sign-in is available", async () => {
    const body = await (await identityGET(identityRequest())).json();
    expect(body).toMatchObject({ role: "anonymous", devSignIn: true });
  });

  it("says nothing when a guard fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await (await identityGET(identityRequest())).json()).not.toHaveProperty("devSignIn");
    vi.stubEnv("NODE_ENV", "development");
    expect(
      await (await identityGET(identityRequest("x.ngrok-free.dev"))).json()
    ).not.toHaveProperty("devSignIn");
  });
});
