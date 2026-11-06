// @vitest-environment node
import { nextCacheMock } from "../mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { fc, IO_RUNS } from "./fc";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";
import { signInAsNew, type SignedInSession } from "../utils/session";

/**
 * INVARIANT 3 — `/api/admin/*` refuses everyone who is not staff.
 *
 * Every route handler under `src/app/api/admin/` is discovered (a new one is
 * covered the day it is added) and called with every HTTP method it exports,
 * as an anonymous visitor, a signed-in student, and the public demo identity
 * in both modes, with arbitrary bodies and a guessed `x-admin-secret`. The
 * answer is always a refusal (401, 403 or 404) and never a file or `ok: true`.
 *
 * A static half backs it up: every admin route file asks `can()` itself, so
 * the check cannot live only in a layout or a hidden button.
 */

type Handler = (req: Request) => Promise<Response>;
type RouteModule = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE", Handler>>;

// Lazy, then loaded in beforeAll: an eager glob is hoisted above the next/cache mock.
const loaders = import.meta.glob<RouteModule>("../../src/app/api/admin/**/route.ts");
const sources = import.meta.glob<string>("../../src/app/api/admin/**/route.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
interface Endpoint {
  file: string;
  path: string;
  method: (typeof METHODS)[number];
  handler: Handler;
}
const endpoints: Endpoint[] = [];

const AUTH_SECRET = "admin-routes-invariant-secret";
const REVALIDATE_SECRET = "the-real-revalidate-secret";

let student: SignedInSession;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  student = await signInAsNew({ role: "user" });
  for (const [file, load] of Object.entries(loaders)) {
    const mod = await load();
    for (const method of METHODS) {
      const handler = mod[method];
      if (typeof handler !== "function") continue;
      endpoints.push({ file, path: file.replace("../../src/app", "").replace(/\/route\.ts$/, ""), method, handler });
    }
  }
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("ADMIN_REVALIDATE_SECRET", REVALIDATE_SECRET);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

let ip = 0;

describe("invariant: admin API routes refuse non-staff", () => {
  it("finds the admin routes (a glob that matched nothing would pass vacuously)", () => {
    expect(endpoints.length).toBeGreaterThanOrEqual(3);
  });

  it("every admin route file checks can() itself", () => {
    for (const [file, source] of Object.entries(sources)) {
      expect(source, `${file} must call can(identity, …)`).toMatch(/\bcan\(\s*identity\s*,/);
      expect(source, `${file} must resolve the identity`).toMatch(/resolveIdentity\(/);
    }
  });

  it("anonymous, student and demo callers are always refused", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...endpoints),
        fc.constantFrom("anonymous", "student", "demo-booth", "demo-view"),
        fc.option(fc.json(), { nil: undefined }),
        fc.option(
          fc.string({ maxLength: 40 }).map((s) => s.replace(/[\r\n\0]/g, "")).filter((s) => s !== REVALIDATE_SECRET),
          { nil: undefined }
        ),
        async (endpoint, who, body, guessedSecret) => {
          vi.stubEnv("DEMO_ADMIN", who === "demo-booth" ? "1" : who === "demo-view" ? "view" : "");
          ip = (ip + 1) % 250;
          const headers: Record<string, string> = {
            "x-forwarded-for": `192.0.2.${ip + 1}`,
            "content-type": "application/json",
          };
          if (who === "student") headers.cookie = student.cookie;
          if (guessedSecret !== undefined) headers["x-admin-secret"] = guessedSecret;
          const hasBody = endpoint.method !== "GET" && body !== undefined;
          const res = await endpoint.handler(
            new Request(`https://makerlab.example${endpoint.path}`, {
              method: endpoint.method,
              headers,
              body: hasBody ? body : undefined,
            })
          );
          const label = `${endpoint.method} ${endpoint.path} as ${who}`;
          expect([401, 403, 404, 429], label).toContain(res.status);
          expect(res.headers.get("Content-Disposition"), label).toBeNull();
          const text = await res.text();
          expect(text, label).not.toMatch(/"ok"\s*:\s*true/);
        }
      ),
      { numRuns: IO_RUNS * 3 }
    );
  });
});

