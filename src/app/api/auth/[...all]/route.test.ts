/**
 * @vitest-environment node
 *
 * Node, not jsdom — same reason as `lib/auth/config.test.ts`: Better Auth's
 * token encryption goes through `jose`, whose `instanceof Uint8Array` check
 * fails across jsdom's realm.
 */
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";

const ORIGIN = "http://localhost:3000";

function stubSessionEnv() {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "route-test-secret");
  vi.stubEnv("AUTH_BASE_URL", ORIGIN);
}

function stubAuthEnv() {
  stubSessionEnv();
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
}

// The limiter is a per-process singleton keyed by hashed IP — give each test
// its own so one test's requests never spend another's allowance.
let counter = 0;
function uniqueIp() {
  counter += 1;
  return `198.51.100.${counter}`;
}

function authRequest(
  path: string,
  { ip = uniqueIp(), method = "GET", body }: { ip?: string; method?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = { "x-forwarded-for": ip, origin: ORIGIN };
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}/api/auth${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

describe("GET|POST /api/auth/* — no AUTH_SECRET", () => {
  it("answers 503 rather than throwing, so the rest of the app still works", async () => {
    const res = await GET(authRequest("/get-session"));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });

  it("does the same for POST", async () => {
    const res = await POST(
      authRequest("/sign-in/social", { method: "POST", body: { provider: "google" } })
    );
    expect(res.status).toBe(503);
  });
});

describe("GET|POST /api/auth/* — sessions but no Google", () => {
  // How the E2E suite runs, and how a deployment looks before the OAuth client
  // exists: real sessions, no way to start one through Google.
  it("still answers get-session, so a seeded cookie works", async () => {
    stubSessionEnv();
    const res = await GET(authRequest("/get-session"));
    expect(res.status).toBe(200);
  });

  it("refuses social sign-in with the 503 the header renders as unconfigured", async () => {
    stubSessionEnv();
    const res = await POST(
      authRequest("/sign-in/social", {
        method: "POST",
        body: { provider: "google", callbackURL: "/" },
      })
    );
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });
});

describe("GET|POST /api/auth/* — configured", () => {
  it("hands the request to Better Auth", async () => {
    stubAuthEnv();
    const res = await GET(authRequest("/get-session"));
    expect(res.status).toBe(200);
    // No cookie was sent, so there is no session — but the handler answered.
    expect(await res.json()).toBeNull();
  });

  it("starts the Google flow with the hd hint", async () => {
    stubAuthEnv();
    const res = await POST(
      authRequest("/sign-in/social", {
        method: "POST",
        body: { provider: "google", callbackURL: "/" },
      })
    );
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).searchParams.get("hd")).toBe("cornell.edu");
  });
});

describe("the admin plugin's own endpoints are not exposed", () => {
  /**
   * The regression this guards: the catch-all mounts every endpoint the admin
   * plugin registers, so `/api/auth/admin/set-role` was a second way to change
   * a role — one that writes no `audit_events` row, consults no super-admin
   * floor, has no "last super admin" guard and is outside `ADMIN_ACTION_TIER`.
   * Anyone holding a director's session cookie could have used it from the
   * browser console on the site's own origin.
   */
  async function seedDirectorCookie() {
    const { signInAsNew } = await import("../../../../../test/utils/session");
    return signInAsNew({ email: "director@cornell.edu", role: "super_admin" });
  }

  it("refuses set-role even when a real super admin asks", async () => {
    stubAuthEnv();
    const director = await seedDirectorCookie();
    const { seedUser } = await import("../../../../../test/utils/session");
    const target = await seedUser({ email: "student-plugin@cornell.edu", role: "user" });

    const req = new Request(`${ORIGIN}/api/auth/admin/set-role`, {
      method: "POST",
      headers: {
        "x-forwarded-for": uniqueIp(),
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: director.cookie,
      },
      body: JSON.stringify({ userId: target.id, role: "super_admin" }),
    });
    const res = await POST(req);

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("admin_api_not_exposed");

    // The row is the assertion that matters: a 403 that still wrote would be
    // worse than no check at all.
    const { findUserById } = await import("@/lib/data/users");
    expect((await findUserById(target.id))?.role).toBe("user");
  });

  it("refuses every other plugin path too, however it is spelled", async () => {
    stubAuthEnv();
    for (const path of [
      "/admin/ban-user",
      "/admin/update-user",
      "/admin/remove-user",
      "/admin/list-users",
      "/admin/impersonate-user",
      "/ADMIN/set-role",
      "/%61dmin/set-role",
    ]) {
      const res = await POST(authRequest(path, { method: "POST", body: {} }));
      expect(res.status, path).toBe(403);
    }
  });

  it("refuses before asking whether auth is configured at all", async () => {
    // No AUTH_SECRET: the answer is still "not exposed", not "not configured".
    const res = await POST(
      authRequest("/admin/set-role", { method: "POST", body: {} })
    );
    expect(res.status).toBe(403);
  });

  it("leaves the ordinary endpoints alone", async () => {
    stubSessionEnv();
    expect((await GET(authRequest("/get-session"))).status).toBe(200);
  });
});

describe("rate limiting", () => {
  it("refuses past the per-IP ceiling before ever calling Google", async () => {
    stubAuthEnv();
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await GET(authRequest("/get-session", { ip }))).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("limits before the 503, so an unconfigured endpoint is not a free amplifier", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 20; i += 1) await GET(authRequest("/get-session", { ip }));
    const res = await GET(authRequest("/get-session", { ip }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
