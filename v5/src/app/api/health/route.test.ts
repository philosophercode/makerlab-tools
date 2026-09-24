// @vitest-environment node
// `nextCacheMock` is imported first on purpose: `vi.mock` is hoisted above
// every import, and its factory can only reach a module imported before the
// one it replaces.
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheLife } from "next/cache";
import { HEALTH_CACHE } from "../../../lib/cache";
import { resetDbForTests } from "../../../lib/db/client";
import { GET } from "./route";

// ── Helpers ─────────────────────────────────────────────────────────

// The in-memory limiter is a per-process singleton keyed by IP, so every test
// gets its own address rather than eating a shared window.
let ipCounter = 0;
function makeRequest(ip = `10.0.0.${++ipCounter}`) {
  return new Request("http://localhost/api/health", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  // Force the demo substrate regardless of the host shell's own env, matching
  // the rest of the catalogue test suite (see src/lib/catalog.test.ts).
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGLITE_DATA_DIR", "");
  // The degraded path logs the real reason server-side; keep it out of the
  // test output (and prove nothing about it reaches the response body below).
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetDbForTests();
});

// ── Healthy (demo substrate) ────────────────────────────────────────
//
// `DATABASE_URL` unset is the default in every test, and it is a normal,
// expected state — not a failure — so it reports `status: "ok"` with
// `database: "demo"`, distinct from a real Postgres that is actually down.

describe("GET /api/health — healthy (demo substrate)", () => {
  it("returns 200 with status ok, database demo, and the seeded tool count", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("demo");
    expect(body.catalog).toBe("demo");
    expect(body.toolCount).toBe(2); // the seeded demo catalogue: form-4, trotec-speedy-400
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it("caches the probe on the 30s health profile", async () => {
    await GET(makeRequest());

    expect(vi.mocked(cacheLife)).toHaveBeenCalledWith(HEALTH_CACHE);
  });

  it("does not let a client or CDN store the verdict", async () => {
    const res = await GET(makeRequest());

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ── Local (PGLITE_DATA_DIR) ─────────────────────────────────────────
//
// A persistent PGlite on a laptop is real data: probed, reported as "local"
// rather than "ok" or "demo", and its catalogue is live (so no demo banner).

describe("GET /api/health — local substrate", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "health-pglite-"));
    vi.stubEnv("PGLITE_DATA_DIR", dir);
  });

  afterEach(async () => {
    resetDbForTests();
    await rm(dir, { recursive: true, force: true });
  });

  it("returns 200 with database local, a live catalog, and the directory's (unseeded) count", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.database).toBe("local");
    expect(body.catalog).toBe("live");
    expect(body.toolCount).toBe(0);
  });
});

// ── Unreachable (a configured database that pingDb cannot reach) ────
//
// `dataSubstrate()` and `pingDb()` are mocked directly rather than pointed at
// a real broken connection string, matching the `src/lib/catalog.test.ts`
// "a database failure" pattern: `vi.doMock` + a fresh dynamic `import()`, so
// only this one route instance sees the failure and every other test keeps
// the real module and its memoised PGlite handle.

describe("GET /api/health — unreachable", () => {
  afterEach(() => {
    vi.doUnmock("../../../lib/db/client");
    vi.resetModules();
  });

  it("returns 503 with database unreachable, degraded status, no live catalog, and no invented count", async () => {
    vi.resetModules();
    vi.doMock("../../../lib/db/client", () => ({
      dataSubstrate: () => "neon",
      pingDb: () => Promise.reject(new Error("connection terminated unexpectedly")),
    }));
    const { GET: GETWithBrokenDb } = await import("./route");

    const res = await GETWithBrokenDb(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("unreachable");
    expect(body.catalog).toBe("demo");
    // Article 4: never invented data — a Postgres this probe just proved down
    // is never asked for a tool count.
    expect(body.toolCount).toBe(0);
  });
});

// ── Disclosure ──────────────────────────────────────────────────────
//
// A health endpoint that echoes a driver error or connection string hands an
// attacker the configuration. The body is three enum words, a count, and a
// timestamp — nothing else, on any path.

describe("GET /api/health — leaks nothing", () => {
  afterEach(() => {
    vi.doUnmock("../../../lib/db/client");
    vi.resetModules();
  });

  it("returns exactly the documented fields and nothing more", async () => {
    const body = await (await GET(makeRequest())).json();

    expect(Object.keys(body).sort()).toEqual([
      "catalog",
      "checkedAt",
      "database",
      "status",
      "toolCount",
    ]);
  });

  it("does not echo the driver error or connection string when unreachable", async () => {
    const SENSITIVE = "postgres://admin:hunter2@db.internal.example.com/prod";
    vi.resetModules();
    vi.doMock("../../../lib/db/client", () => ({
      dataSubstrate: () => "neon",
      pingDb: () => Promise.reject(new Error(`could not connect to ${SENSITIVE}: ECONNREFUSED`)),
    }));
    const { GET: GETWithBrokenDb } = await import("./route");

    const raw = await (await GETWithBrokenDb(makeRequest())).text();

    for (const needle of [SENSITIVE, "hunter2", "ECONNREFUSED", "postgres://"]) {
      expect(raw).not.toContain(needle);
    }
  });
});

// ── Rate limiting ───────────────────────────────────────────────────

describe("GET /api/health — rate limiting", () => {
  it("429s a caller that hammers it, before touching the database", async () => {
    const ip = "10.9.9.9";

    let last = await GET(makeRequest(ip));
    for (let i = 0; i < 30 && last.status !== 429; i += 1) {
      last = await GET(makeRequest(ip));
    }

    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBe("60");
  });
});
