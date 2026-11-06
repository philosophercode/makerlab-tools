// @vitest-environment node
import { nextCacheMock } from "../mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../ai/models-stub")).stubModelsModule(await importOriginal())
);

import { fc, IO_RUNS } from "./fc";
import { resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";
import { signInAsNew, type SignedInSession } from "../utils/session";

/**
 * INVARIANT 10 — malformed input is a 4xx, never a crash.
 *
 * Every public POST route that parses a request body is sent arbitrary JSON,
 * arbitrary text and the wrong content types, both anonymously and as a
 * director (so the body is parsed, not just refused at the door). The route
 * must answer with a 4xx (or a deliberate 501/503 "not configured here"),
 * never a 500, and never echo a stack trace or an internal error's
 * words: a Zod schema (or an equivalent check) stands between the body and
 * everything behind it.
 */

type Handler = (req: Request) => Promise<Response>;

// Some handlers take a NextRequest; a plain Request is what reaches them at runtime.
const loaders: Record<string, () => Promise<{ POST: unknown }>> = {
  "/api/chat": () => import("@/app/api/chat/route"),
  "/api/report": () => import("@/app/api/report/route"),
  "/api/flags": () => import("@/app/api/flags/route"),
  "/api/projects": () => import("@/app/api/projects/route"),
  "/api/usage": () => import("@/app/api/usage/route"),
  "/api/demo-pass": () => import("@/app/api/demo-pass/route"),
  "/api/action-proposals": () => import("@/app/api/action-proposals/route"),
  "/api/chat-proposals": () => import("@/app/api/chat-proposals/route"),
  "/api/imports": () => import("@/app/api/imports/route"),
  "/api/pending-tools/research": () => import("@/app/api/pending-tools/research/route"),
  "/api/uploads/token": () => import("@/app/api/uploads/token/route"),
};

const AUTH_SECRET = "api-fuzz-invariant-secret";
const routes: { path: string; POST: Handler }[] = [];
let director: SignedInSession;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  director = await signInAsNew({ role: "super_admin" });
  for (const [path, load] of Object.entries(loaders)) routes.push({ path, POST: (await load()).POST as Handler });
}, 60_000);

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("DEMO_ADMIN", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

/** Bodies a schema must refuse: random JSON, near-miss shapes, raw text. */
const body = fc.oneof(
  fc.json({ maxDepth: 3 }),
  fc.jsonValue({ maxDepth: 3 }).map((v) => JSON.stringify({ messages: v, tool: v, id: v, items: v })),
  fc.string({ maxLength: 300 }),
  fc.constantFrom("", "{", "null", "[]", '{"__proto__":{"admin":true}}', "\u0000\u0001", "{}".repeat(5000))
);
const contentType = fc.constantFrom("application/json", "text/plain", "multipart/form-data; boundary=x", "");

let ip = 0;

describe("invariant: malformed bodies never crash a route", () => {
  it("answers below 500 with no stack trace, anonymous or signed in", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.nat({ max: Object.keys(loaders).length - 1 }),
        body,
        contentType,
        fc.boolean(),
        async (which, payload, type, signedIn) => {
          const route = routes[which];
          ip = (ip + 1) % 250;
          const headers: Record<string, string> = {
            "x-forwarded-for": `100.64.1.${ip + 1}`,
            origin: "https://makerlab.example",
            host: "makerlab.example",
          };
          if (type) headers["content-type"] = type;
          if (signedIn) headers.cookie = director.cookie;
          const res = await route.POST(
            new Request(`https://makerlab.example${route.path}`, { method: "POST", headers, body: payload })
          );
          const label = `${route.path} (${signedIn ? "director" : "anonymous"}, ${type || "no type"}) ← ${JSON.stringify(payload).slice(0, 120)}`;
          // 501/503 are deliberate "not set up here" answers (no Blob store, no
          // database); anything else at 5xx is a crash.
          if (res.status >= 500) expect([501, 503], label).toContain(res.status);
          const text = await res.text();
          expect(text, label).not.toMatch(/\n\s+at .+\(.+:\d+:\d+\)|ZodError|TypeError|SyntaxError: /);
        }
      ),
      { numRuns: IO_RUNS * 6 }
    );
  }, 120_000);
});
