import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * INVARIANT 5 — every API route is rate-limited before it does work.
 *
 * AGENTS.md: "Every API route is rate-limited by identity before expensive
 * work." Each `src/app/api/**\/route.ts` must call the limiter itself, or hand
 * the whole request to a module that does (named below, and checked). A new
 * route without one fails here until it gets a limiter or a reasoned entry.
 */

const ROOT = join(__dirname, "../..");
const API = join(ROOT, "src/app/api");
const LIMITER = /\b(rateLimit|rateLimitAsync|checkRateLimit)\s*\(/;

/** Routes that delegate the request whole, and the module that limits it. */
const DELEGATES: Record<string, { module: string; why: string }> = {
  "src/app/api/mcp/route.ts": { module: "src/lib/mcp/handler.ts", why: "handleMcpRequest limits by caller" },
  "src/app/api/mcp/signed-in/route.ts": { module: "src/lib/mcp/handler.ts", why: "handleMcpRequest limits by caller" },
  "src/app/api/notifications/unsubscribe/route.ts": {
    module: "src/lib/notifications/unsubscribe-limit.ts",
    why: "allowUnsubscribeRequest limits by hashed IP, first thing",
  },
};

/** Routes with no limiter at all, and the guard that makes them inert where it matters. */
const INERT: Record<string, { guard: RegExp; why: string }> = {
  "src/app/api/dev-blob/[...path]/route.ts": {
    guard: /blobMode\(\)\s*!==\s*"local"\)\s*return notFound\(\)/,
    why: "local Blob store for development; a 404 on Vercel and in production builds",
  },
};

function routes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) routes(full, out);
    else if (name === "route.ts") out.push(relative(ROOT, full));
  }
  return out;
}

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

describe("invariant: every API route is rate-limited", () => {
  const all = routes(API).sort();

  it("finds the API routes", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all)("%s", (file) => {
    const source = read(file);
    if (LIMITER.test(source)) return;

    const delegate = DELEGATES[file];
    if (delegate) {
      expect(read(delegate.module), `${delegate.module} (${delegate.why})`).toMatch(LIMITER);
      return;
    }
    const inert = INERT[file];
    expect(inert, `${file} calls no rate limiter and is not a listed exception`).toBeDefined();
    expect(source, inert!.why).toMatch(inert!.guard);
  });

  it("lists no exception for a route that no longer exists", () => {
    for (const file of [...Object.keys(DELEGATES), ...Object.keys(INERT)]) expect(all).toContain(file);
  });
});
