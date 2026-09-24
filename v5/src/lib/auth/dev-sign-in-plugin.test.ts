// @vitest-environment node
/**
 * The Better Auth endpoint behind development-only sign-in. The route tests
 * cover it end to end; these pin the two properties that hold even if the
 * route were bypassed: it has no URL, and it refuses outside `next dev`.
 */
import { POST } from "@/app/api/auth/[...all]/route";
import { getAuth, resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "dev-sign-in-plugin-secret");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEV_AUTO_SIGN_IN", "1");
  resetAuthForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
  resetDbForTests();
});

describe("devSignIn endpoint", () => {
  it("refuses in production when called directly, even with DEV_AUTO_SIGN_IN=1", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const auth = await getAuth();
    await expect(
      auth!.api.devSignIn({ body: { email: "someone@cornell.edu" } })
    ).rejects.toMatchObject({ body: { code: "DEV_SIGN_IN_DISABLED" } });
  });

  it("is not reachable over HTTP at /api/auth/dev-sign-in, even in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST(
      new Request("http://localhost:3000/api/auth/dev-sign-in", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "127.0.0.1",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email: "someone@cornell.edu" }),
      })
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
