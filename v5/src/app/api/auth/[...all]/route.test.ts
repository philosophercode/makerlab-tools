/**
 * @vitest-environment node
 *
 * Node, not jsdom — same reason as `lib/auth/config.test.ts`: Better Auth's
 * token encryption goes through `jose`, whose `instanceof Uint8Array` check
 * fails across jsdom's realm.
 */
import { GET, POST } from "@/app/api/auth/[...all]/route";
import { resetAuthForTests } from "@/lib/auth/config";

const ORIGIN = "http://localhost:3000";

function stubAuthEnv() {
  vi.stubEnv("AUTH_SECRET", "route-test-secret");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.stubEnv("AUTH_BASE_URL", ORIGIN);
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
  resetAuthForTests();
});

describe("GET|POST /api/auth/* — not configured", () => {
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
