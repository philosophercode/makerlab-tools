import { http, HttpResponse } from "msw";

import { server } from "../../../../test/msw/server";
import { DB_IDS } from "../../../../test/msw/handlers";
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { cacheLife } from "next/cache";
import { mockTools } from "../../../components/mock-catalog";
import { HEALTH_CACHE } from "../../../lib/cache";
import { GET } from "./route";

// ── Helpers ─────────────────────────────────────────────────────────

function stubNotionEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_TOOLS", DB_IDS.tools);
  vi.stubEnv("NOTION_DB_CATEGORIES", DB_IDS.categories);
  vi.stubEnv("NOTION_DB_LOCATIONS", DB_IDS.locations);
  vi.stubEnv("NOTION_DB_UNITS", DB_IDS.units);
  vi.stubEnv("NOTION_DB_RESOURCES", DB_IDS.resources);
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", DB_IDS.maintenance_logs);
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
}

function unsetNotionEnv() {
  vi.stubEnv("NOTION_API_KEY", "");
  vi.stubEnv("NOTION_DB_TOOLS", "");
  vi.stubEnv("NOTION_DB_CATEGORIES", "");
  vi.stubEnv("NOTION_DB_LOCATIONS", "");
  vi.stubEnv("NOTION_DB_UNITS", "");
  vi.stubEnv("NOTION_DB_RESOURCES", "");
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", "");
  vi.stubEnv("NOTION_DB_FLAGS", "");
}

// The in-memory limiter is a per-process singleton keyed by IP, so every test
// gets its own address rather than eating a shared window.
let ipCounter = 0;
function makeRequest(ip = `10.0.0.${++ipCounter}`) {
  return new Request("http://localhost/api/health", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  // The degraded paths log the real reason server-side; keep it out of the
  // test output (and prove nothing about it reaches the response body below).
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ── Healthy ─────────────────────────────────────────────────────────

describe("GET /api/health — healthy", () => {
  it("returns 200 with status ok, notion ok, and a live catalog", async () => {
    stubNotionEnv();

    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.notion).toBe("ok");
    expect(body.catalog).toBe("live");
    expect(body.toolCount).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
  });

  it("probes Notion with a single page_size:1 query against the Tools database", async () => {
    stubNotionEnv();

    const probes: Array<{ db: string; body: unknown }> = [];
    server.use(
      http.post(
        `https://api.notion.com/v1/databases/${DB_IDS.tools}/query`,
        async ({ request }) => {
          probes.push({ db: DB_IDS.tools, body: await request.json() });
          return HttpResponse.json({ results: [], has_more: false, next_cursor: null });
        }
      )
    );

    await GET(makeRequest());

    // First hit is the health probe itself; anything after is the catalog read.
    expect(probes.length).toBeGreaterThan(0);
    expect(probes[0].body).toEqual({ page_size: 1 });
  });

  it("caches the probe on the 30s health profile", async () => {
    stubNotionEnv();

    await GET(makeRequest());

    expect(vi.mocked(cacheLife)).toHaveBeenCalledWith(HEALTH_CACHE);
  });

  it("does not let a client or CDN store the verdict", async () => {
    stubNotionEnv();

    const res = await GET(makeRequest());

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// ── Unconfigured ────────────────────────────────────────────────────

describe("GET /api/health — unconfigured", () => {
  it("returns 503 with notion unconfigured when the Notion env is empty", async () => {
    unsetNotionEnv();

    const res = await GET(makeRequest());

    // The status code is the point: an uptime monitor alerts on 503, and would
    // never notice a 200 carrying "degraded".
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.notion).toBe("unconfigured");
    expect(body.catalog).toBe("mock");
    expect(body.toolCount).toBe(mockTools.length);
  });

  it("returns 503 when a single NOTION_DB_* variable is dropped", async () => {
    stubNotionEnv();
    vi.stubEnv("NOTION_DB_UNITS", "");

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.notion).toBe("unconfigured");
  });
});

// ── Unreachable ─────────────────────────────────────────────────────

describe("GET /api/health — unreachable", () => {
  it("returns 503 with notion unreachable when the Notion query throws", async () => {
    stubNotionEnv();
    server.use(
      http.post("https://api.notion.com/v1/databases/:id/query", () => HttpResponse.error())
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("degraded");
    expect(body.notion).toBe("unreachable");
    expect(body.catalog).toBe("mock");
    expect(body.toolCount).toBe(mockTools.length);
  });

  it("returns 503 with notion unreachable when Notion answers non-2xx", async () => {
    stubNotionEnv();
    server.use(
      http.post("https://api.notion.com/v1/databases/:id/query", () =>
        HttpResponse.json({ object: "error", code: "unauthorized" }, { status: 401 })
      )
    );

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    expect((await res.json()).notion).toBe("unreachable");
  });
});

// ── Disclosure ──────────────────────────────────────────────────────
//
// A health endpoint that names the missing variable or echoes the Notion error
// hands an attacker the configuration. The body is three enum words, a count,
// and a timestamp — nothing else, on any path.

describe("GET /api/health — leaks nothing", () => {
  const FORBIDDEN = [
    "NOTION_",
    "notion.com",
    "secret_test",
    "Bearer",
    DB_IDS.tools,
    DB_IDS.units,
  ];

  it("names no env var, Notion id, or error text when unconfigured", async () => {
    unsetNotionEnv();

    const raw = await (await GET(makeRequest())).text();

    for (const needle of FORBIDDEN) expect(raw).not.toContain(needle);
  });

  it("does not echo the Notion error body when unreachable", async () => {
    stubNotionEnv();
    server.use(
      http.post("https://api.notion.com/v1/databases/:id/query", () =>
        HttpResponse.json(
          {
            object: "error",
            code: "unauthorized",
            message: "API token is invalid: secret_test against db-tools",
          },
          { status: 401 }
        )
      )
    );

    const raw = await (await GET(makeRequest())).text();

    for (const needle of FORBIDDEN) expect(raw).not.toContain(needle);
    expect(raw).not.toContain("API token is invalid");
    expect(raw).not.toContain("unauthorized");
  });

  it("returns exactly the documented fields and nothing more", async () => {
    unsetNotionEnv();

    const body = await (await GET(makeRequest())).json();

    expect(Object.keys(body).sort()).toEqual([
      "catalog",
      "checkedAt",
      "notion",
      "status",
      "toolCount",
    ]);
  });
});

// ── Rate limiting ───────────────────────────────────────────────────

describe("GET /api/health — rate limiting", () => {
  it("429s a caller that hammers it, before touching Notion", async () => {
    unsetNotionEnv();
    const ip = "10.9.9.9";

    let last = await GET(makeRequest(ip));
    for (let i = 0; i < 30 && last.status !== 429; i += 1) {
      last = await GET(makeRequest(ip));
    }

    expect(last.status).toBe(429);
    expect(last.headers.get("Retry-After")).toBe("60");
  });
});
