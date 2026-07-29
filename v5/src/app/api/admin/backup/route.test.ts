import { http, HttpResponse } from "msw";
import { server } from "../../../../../test/msw/server";
import { DB_IDS } from "../../../../../test/msw/handlers";

// Vercel Blob is the only external service here that MSW cannot stand in for
// (the SDK talks to a signed API and would need a token), so it is mocked at
// the seam `blob.ts` exists to provide. `vi.hoisted` because the `vi.mock`
// factory runs before module scope exists.
const blob = vi.hoisted(() => ({
  configured: { value: true },
  put: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../../../lib/blob", () => ({
  isBlobConfigured: () => blob.configured.value,
  getBlobStore: () => ({ put: blob.put, list: blob.list, del: blob.del }),
}));

import { GET } from "./route";

const NOTION = "https://api.notion.com/v1";
const ADMIN_SECRET = "admin-s3cret";
const CRON_SECRET = "cron-s3cret";

// The in-memory limiter is a per-process singleton keyed by hashed IP, so every
// test gets its own IP rather than sharing (and eventually exhausting) a window.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function makeRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/backup", {
    method: "GET",
    headers: { "x-forwarded-for": uniqueIp(), ...headers },
  });
}

function adminRequest() {
  return makeRequest({ "x-admin-secret": ADMIN_SECRET });
}

/** The seven catalog databases, pointed at the MSW fixture sentinels. */
function stubNotionEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_TOOLS", DB_IDS.tools);
  vi.stubEnv("NOTION_DB_CATEGORIES", DB_IDS.categories);
  vi.stubEnv("NOTION_DB_LOCATIONS", DB_IDS.locations);
  vi.stubEnv("NOTION_DB_UNITS", DB_IDS.units);
  vi.stubEnv("NOTION_DB_RESOURCES", DB_IDS.resources);
  vi.stubEnv("NOTION_DB_MAINTENANCE_LOGS", DB_IDS.maintenance_logs);
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
  vi.stubEnv("NOTION_DB_PROJECTS", "");
}

/** The body handed to `store.put`, parsed. */
function writtenFile() {
  const [, body] = blob.put.mock.calls[0];
  return JSON.parse(body as string);
}

beforeEach(() => {
  blob.configured.value = true;
  blob.put.mockReset().mockResolvedValue({ pathname: "written" });
  blob.list.mockReset().mockResolvedValue([]);
  blob.del.mockReset().mockResolvedValue(undefined);

  vi.stubEnv("ADMIN_REVALIDATE_SECRET", ADMIN_SECRET);
  vi.stubEnv("CRON_SECRET", CRON_SECRET);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
  stubNotionEnv();
});

describe("GET /api/admin/backup — authorization", () => {
  it("returns 503 when neither ADMIN_REVALIDATE_SECRET nor CRON_SECRET is set", async () => {
    vi.stubEnv("ADMIN_REVALIDATE_SECRET", "");
    vi.stubEnv("CRON_SECRET", "");

    const res = await GET(makeRequest({ "x-admin-secret": "anything" }));

    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
    // Unconfigured must never mean "open": nothing was read or written.
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 403 when the secret header is missing", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 403 when the x-admin-secret header is wrong", async () => {
    const res = await GET(makeRequest({ "x-admin-secret": "wrong" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 403 when the cron Authorization bearer is wrong", async () => {
    const res = await GET(makeRequest({ authorization: "Bearer not-the-secret" }));

    expect(res.status).toBe(403);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("accepts a Vercel Cron request carrying Authorization: Bearer $CRON_SECRET", async () => {
    const res = await GET(makeRequest({ authorization: `Bearer ${CRON_SECRET}` }));

    expect(res.status).toBe(200);
    expect(blob.put).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/admin/backup — serialization", () => {
  it("writes one private JSON file per day, named backups/YYYY-MM-DD.json", async () => {
    const res = await GET(adminRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.pathname).toMatch(/^backups\/\d{4}-\d{2}-\d{2}\.json$/);
    expect(body.retentionDays).toBe(30);

    const [pathname, , contentType] = blob.put.mock.calls[0];
    expect(pathname).toBe(body.pathname);
    expect(contentType).toBe("application/json");
  });

  it("serializes every configured database as raw Notion pages", async () => {
    await GET(adminRequest());

    const file = writtenFile();
    expect(file.version).toBe(1);
    expect(file.source).toBe("notion");
    expect(typeof file.createdAt).toBe("string");
    expect(Object.keys(file.databases).sort()).toEqual([
      "categories",
      "flags",
      "locations",
      "maintenance_logs",
      "resources",
      "tools",
      "units",
    ]);

    // Raw pages, not the app's mapped records — a backup restores what Notion
    // had, and `notion.ts`'s mapping deliberately drops properties.
    expect(file.databases.tools).toMatchObject({
      databaseId: DB_IDS.tools,
      pageCount: 1,
    });
    expect(file.databases.tools.pages[0]).toMatchObject({
      object: "page",
      id: "tool-1",
    });
    expect(file.databases.tools.pages[0].properties.name).toBeDefined();

    // An empty database is recorded as empty rather than omitted.
    expect(file.databases.flags).toEqual({
      databaseId: DB_IDS.flags,
      pageCount: 0,
      pages: [],
    });
  });

  it("reports the page count of each database in the response", async () => {
    const res = await GET(adminRequest());

    const body = await res.json();
    expect(body.databases).toMatchObject({ tools: 1, flags: 0 });
    expect(body.bytes).toBeGreaterThan(0);
  });

  it("includes the optional Projects database when NOTION_DB_PROJECTS is set", async () => {
    vi.stubEnv("NOTION_DB_PROJECTS", "db-projects");
    server.use(
      http.post(`${NOTION}/databases/db-projects/query`, () =>
        HttpResponse.json({ object: "list", results: [], has_more: false, next_cursor: null })
      )
    );

    await GET(adminRequest());

    expect(Object.keys(writtenFile().databases)).toContain("projects");
  });

  it("follows Notion pagination rather than storing only the first page", async () => {
    let call = 0;
    server.use(
      http.post(`${NOTION}/databases/${DB_IDS.units}/query`, () => {
        call += 1;
        return HttpResponse.json({
          object: "list",
          results: [{ object: "page", id: `unit-${call}` }],
          has_more: call === 1,
          next_cursor: call === 1 ? "cursor-2" : null,
        });
      })
    );

    await GET(adminRequest());

    expect(writtenFile().databases.units.pageCount).toBe(2);
  });
});

describe("GET /api/admin/backup — failures are loud", () => {
  it("returns 500 when a Notion fetch fails, naming the database", async () => {
    server.use(
      http.post(`${NOTION}/databases/${DB_IDS.tools}/query`, () =>
        HttpResponse.json({ message: "boom" }, { status: 500 })
      )
    );

    const res = await GET(adminRequest());

    // Non-200 is the contract: this is how a broken backup shows up in Vercel's
    // cron log instead of being discovered on the day it is needed.
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, stage: "notion", table: "tools" });
    // Nothing partial is written.
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 500 when the blob write fails", async () => {
    blob.put.mockRejectedValue(new Error("blob store unavailable"));

    const res = await GET(adminRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, stage: "blob" });
  });

  it("returns 500 but reports written:true when only the prune step fails", async () => {
    blob.list.mockRejectedValue(new Error("list failed"));

    const res = await GET(adminRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      ok: false,
      stage: "prune",
      written: true,
    });
  });

  it("returns 503 when BLOB_READ_WRITE_TOKEN is not configured", async () => {
    blob.configured.value = false;

    const res = await GET(adminRequest());

    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it("returns 503 rather than a partial file when a NOTION_DB_* id is missing", async () => {
    vi.stubEnv("NOTION_DB_UNITS", "");

    const res = await GET(adminRequest());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("NOTION_DB_UNITS");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("returns 503 when NOTION_API_KEY is missing", async () => {
    vi.stubEnv("NOTION_API_KEY", "");

    const res = await GET(adminRequest());

    expect(res.status).toBe(503);
    expect(blob.put).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/backup — 30-day retention", () => {
  function daysAgo(days: number) {
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return `backups/${date.toISOString().slice(0, 10)}.json`;
  }

  it("deletes backups older than 30 days and keeps the rest", async () => {
    const old = daysAgo(45);
    const boundary = daysAgo(30);
    const recent = daysAgo(29);
    blob.list.mockResolvedValue(
      [old, boundary, recent].map((pathname) => ({
        pathname,
        uploadedAt: new Date().toISOString(),
      }))
    );

    const res = await GET(adminRequest());

    const body = await res.json();
    expect(blob.list).toHaveBeenCalledWith("backups/");
    expect(body.pruned.sort()).toEqual([old, boundary].sort());
    expect(blob.del).toHaveBeenCalledWith(body.pruned);
    expect(body.pruned).not.toContain(recent);
  });

  it("never deletes a blob whose pathname it does not recognise", async () => {
    blob.list.mockResolvedValue([
      { pathname: "backups/notes.txt", uploadedAt: "2020-01-01T00:00:00.000Z" },
      { pathname: "backups/2019-01-01.json.bak", uploadedAt: "2019-01-01T00:00:00.000Z" },
    ]);

    const res = await GET(adminRequest());

    expect((await res.json()).pruned).toEqual([]);
    expect(blob.del).toHaveBeenCalledWith([]);
  });
});
