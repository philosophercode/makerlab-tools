// @vitest-environment node
/**
 * `GET /api/identity` — the projection the header reads (spec §3.5, auth spec §6).
 *
 * Uses the real `resolveIdentity` and the real limiter against real session
 * rows in PGlite. No network, no OAuth (Article 3): `signInAsNew` seeds the
 * row and mints the cookie Better Auth would have set.
 */
import { GET } from "@/app/api/identity/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";
import {
  BETTER_AUTH_SESSION_COOKIE,
  seedUser,
  signInAs,
  signInAsNew,
} from "../../../../test/utils/session";

const AUTH_SECRET = "identity-route-test-secret";

// The in-memory limiter is a per-process singleton keyed by identity, so every
// test needs its own IP.
let counter = 0;
function uniqueIp() {
  counter += 1;
  return `203.0.113.${counter}`;
}

function identityRequest({ ip = uniqueIp(), cookie }: { ip?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": ip };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/identity", { headers });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

describe("GET /api/identity", () => {
  it("answers 200 with the anonymous role when there is no cookie", async () => {
    const res = await GET(identityRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "anonymous", name: null });
  });

  it("returns the role and display name of a signed-in user", async () => {
    const { cookie } = await signInAsNew({
      email: "ada@cornell.edu",
      name: "Ada Lovelace",
    });

    const res = await GET(identityRequest({ cookie }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ role: "user", name: "Ada Lovelace" });
  });

  it("reports the role from the database, for every stored role", async () => {
    // What the header reads to decide whether to show Add and Refresh. The
    // env lists that used to answer this question are gone.
    for (const role of ["user", "admin", "super_admin"] as const) {
      const { cookie } = await signInAsNew({ role });
      const body = await (await GET(identityRequest({ cookie }))).json();
      expect(body.role).toBe(role);
    }
  });

  it("never returns the email address — the header only needs a name", async () => {
    const { cookie } = await signInAsNew({
      email: "ada@cornell.edu",
      name: "Ada Lovelace",
    });

    const body = await (await GET(identityRequest({ cookie }))).json();

    expect(body).not.toHaveProperty("email");
    expect(body).not.toHaveProperty("userId");
    expect(JSON.stringify(body)).not.toContain("cornell.edu");
  });

  it("degrades to anonymous on a tampered cookie rather than throwing", async () => {
    const { cookie } = await signInAsNew();
    const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));

    const res = await GET(identityRequest({ cookie: forged }));

    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("anonymous");
  });

  it("degrades to anonymous on an expired session", async () => {
    const { cookie } = await signInAsNew({}, { expiresInSeconds: -60 });

    const res = await GET(identityRequest({ cookie }));

    expect(res.status).toBe(200);
    expect((await res.json()).role).toBe("anonymous");
  });

  it("degrades to anonymous for a banned user", async () => {
    const banned = await seedUser({ banned: true, banReason: "spam" });
    const { cookie } = await signInAs(banned);

    expect((await (await GET(identityRequest({ cookie }))).json()).role).toBe(
      "anonymous"
    );
  });

  it("degrades to anonymous when the cookie names no session at all", async () => {
    const cookie = `${BETTER_AUTH_SESSION_COOKIE}=not-a-real-token`;
    expect((await (await GET(identityRequest({ cookie }))).json()).role).toBe(
      "anonymous"
    );
  });

  it("is never cached — it is per-request and per-person", async () => {
    const res = await GET(identityRequest());
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("is bounded: the ceiling refuses with Retry-After", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 120; i += 1) {
      expect((await GET(identityRequest({ ip }))).status).toBe(200);
    }

    const res = await GET(identityRequest({ ip }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
