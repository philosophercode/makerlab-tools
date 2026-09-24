// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

// The route reaches the catalog (for tool resolution) which imports next/cache.
vi.mock("next/cache", () => nextCacheMock());

import { getCatalogTools } from "@/lib/catalog";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { feedback, tools as toolsTable } from "@/lib/db/schema/index";
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../test/utils/session";
import { POST } from "./route";

/**
 * `POST /api/flags` against the demo-seeded PGlite database, with **no Notion
 * environment stubbed anywhere** — the write is local now, so there is no
 * credential this route could be missing (Article 3).
 */

const AUTH_SECRET = "flags-route-test-secret";

let FORM_4_ID = "";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  const tools = await getCatalogTools();
  FORM_4_ID = tools.find((tool) => tool.slug === "form-4")?.id ?? "";
  const db = await getDb();
  await db.delete(feedback);
});

afterAll(() => {
  resetDbForTests();
});

// The in-memory limiter is a per-process singleton keyed by IP, so each test
// gets its own IP to avoid bleeding a spent window into the next one.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
}

function flagRequest(body: unknown, ip = uniqueIp(), cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/flags", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as never;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    tool_id: FORM_4_ID,
    field_flagged: "location",
    issue_description: "This lives in the Resin Bench, not the Wood Shop.",
    ...overrides,
  };
}

/**
 * A seeded session — a `user` row, a `session` row and the cookie Better Auth
 * would have set. The only way to reach the route as a signed-in person
 * without a network call (Article 3).
 */
async function signedIn(email: string, name: string) {
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  return signInAsNew({ email, name });
}

/** Every correction currently in the table. */
async function storedRows() {
  const db = await getDb();
  return db.select().from(feedback);
}

describe("POST /api/flags", () => {
  it("inserts a feedback row with status `new` and returns 201", async () => {
    const res = await POST(flagRequest(validPayload({ reporter: "Ada" })));

    expect(res.status).toBe(201);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(await res.json()).toEqual({ id: rows[0].id });
    expect(rows[0]).toMatchObject({
      toolId: FORM_4_ID,
      fieldFlagged: "location",
      status: "new",
      reporterName: "Ada",
      issueDescription: "This lives in the Resin Bench, not the Wood Shop.",
    });
  });

  // The assertion that matters (spec §10): a flag is inert.
  it("never writes to the tools table", async () => {
    const db = await getDb();
    const before = await db.select().from(toolsTable);

    await POST(flagRequest(validPayload()));

    expect(await db.select().from(toolsTable)).toEqual(before);
  });

  it("resolves the tool by slug as well as by uuid", async () => {
    const res = await POST(flagRequest(validPayload({ tool_id: "form-4" })));

    expect(res.status).toBe(201);
    expect((await storedRows())[0].toolId).toBe(FORM_4_ID);
  });

  it("records the reporter's email and id from a session, never from the body", async () => {
    const reporter = await signedIn("ada@cornell.edu", "Ada Lovelace");

    const res = await POST(
      flagRequest(
        validPayload({ reporter_email: "dean@cornell.edu" }),
        uniqueIp(),
        reporter.cookie
      )
    );

    expect(res.status).toBe(201);
    const [row] = await storedRows();
    expect(row.reporterEmail).toBe("ada@cornell.edu");
    expect(row.reporterUserId).toBe(reporter.user.id);
    expect(JSON.stringify(row)).not.toContain("dean@cornell.edu");
  });

  it("files an anonymous correction with no email at all", async () => {
    const res = await POST(
      flagRequest(validPayload({ reporter_email: "dean@cornell.edu" }))
    );

    // Anonymous reporting stays the intended default (§8), and a client may
    // not assert who it is.
    expect(res.status).toBe(201);
    const [row] = await storedRows();
    expect(row.reporterEmail).toBeNull();
    expect(row.reporterUserId).toBeNull();
  });

  it("rejects an invalid field_flagged with 400 and writes nothing", async () => {
    const res = await POST(flagRequest(validPayload({ field_flagged: "price" })));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
    expect(await storedRows()).toHaveLength(0);
  });

  it("rejects an empty description with 400", async () => {
    const res = await POST(flagRequest(validPayload({ issue_description: "   " })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
    expect(await storedRows()).toHaveLength(0);
  });

  it("rejects a body that is not JSON with 400", async () => {
    const res = await POST(flagRequest("not json at all"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "invalid_input" });
  });

  it("returns 404 for a tool that is not in the catalog", async () => {
    const res = await POST(flagRequest(validPayload({ tool_id: "tool-nope" })));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: "unknown_tool" });
    expect(await storedRows()).toHaveLength(0);
  });

  it("returns 429 after the fifth report from one IP", async () => {
    const ip = uniqueIp();

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const ok = await POST(flagRequest(validPayload(), ip));
      expect(ok.status, `attempt ${attempt}`).toBe(201);
    }

    const limited = await POST(flagRequest(validPayload(), ip));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("3600");
    expect(await limited.json()).toEqual({ code: "rate_limited" });
    // Rate limiting happens before any database work (Article 4).
    expect(await storedRows()).toHaveLength(5);
  });

  it("returns 502 on a database failure without leaking the driver's error", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@127.0.0.1:1/none");
    resetDbForTests();

    const res = await POST(flagRequest(validPayload()));

    expect(res.status).toBe(502);
    const body = await res.text();
    expect(body).toBe(JSON.stringify({ code: "write_failed" }));
    expect(body).not.toMatch(/hunter2|postgres|ECONNREFUSED/i);
    // The detail is still visible to operators in the server log (Art. 4).
    expect(logged).toHaveBeenCalled();

    // Put the demo substrate back before the file's own cleanup runs: the
    // stub is still in force until vitest's global afterEach clears it.
    vi.stubEnv("DATABASE_URL", "");
    resetDbForTests();
  });
});
