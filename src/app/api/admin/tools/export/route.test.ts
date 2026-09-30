// @vitest-environment node
import { resetAuthForTests } from "../../../../../lib/auth/config";
import { resetDbForTests } from "../../../../../lib/db/client";
import { listToolsForExport } from "../../../../../lib/data/tool-export";
import { TOOL_EXPORT_HEADERS } from "../../../../../lib/export/tool-csv";
import { signInAsNew } from "../../../../../../test/utils/session";
import { POST } from "./route";

/**
 * `POST /api/admin/tools/export` against the PGlite demo seed, with real
 * sessions and real roles: the permission is the route's own, not the button's.
 */

const AUTH_SECRET = "tools-export-route-test-secret";

// The limiter is a per-process singleton keyed by identity; anonymous callers
// share an IP bucket unless each gets its own address.
let counter = 0;
function uniqueIp() {
  counter += 1;
  return `198.51.100.${counter}`;
}

function exportRequest(options: { cookie?: string; body?: unknown; ip?: string } = {}) {
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? uniqueIp(),
    "x-forwarded-host": "makerlab.example",
    "x-forwarded-proto": "https",
    "content-type": "application/json",
  };
  if (options.cookie) headers.cookie = options.cookie;
  return new Request("https://makerlab.example/api/admin/tools/export", {
    method: "POST",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

/** The CSV's records, BOM dropped; good enough for the demo seed's fields (no embedded CRLF). */
function records(csv: string): string[] {
  return csv.replace(/^﻿/, "").split("\r\n").filter(Boolean);
}

describe("POST /api/admin/tools/export", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
    resetAuthForTests();
  });

  afterEach(() => {
    resetAuthForTests();
    resetDbForTests();
  });

  it("refuses an anonymous caller with 401 and no file", async () => {
    const res = await POST(exportRequest({ body: {} }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: "sign_in_required" });
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });

  it("refuses an ordinary user with 403", async () => {
    const { cookie } = await signInAsNew({ role: "user" });
    const res = await POST(exportRequest({ cookie, body: {} }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an admin — export is super admins only", async () => {
    const { cookie } = await signInAsNew({ role: "admin" });
    const res = await POST(exportRequest({ cookie, body: {} }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses a tampered session cookie", async () => {
    const { cookie } = await signInAsNew({ role: "super_admin" });
    const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    const res = await POST(exportRequest({ cookie: forged, body: {} }));
    expect(res.status).toBe(401);
  });

  it("gives a super admin every tool as an uncached CSV attachment", async () => {
    const { cookie } = await signInAsNew({ role: "super_admin" });
    const res = await POST(exportRequest({ cookie, body: {} }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment; filename="makerlab-tools-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const bytes = new Uint8Array(await res.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const lines = records(await res.text());
    expect(lines[0]).toBe(TOOL_EXPORT_HEADERS.join(","));
    const all = await listToolsForExport();
    expect(all.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(all.length + 1);
    // Absolute tool page links on the request's own origin.
    expect(lines[1]).toContain(`https://makerlab.example/tools/${all[0].slug}`);
  });

  it("accepts an empty body as 'every tool'", async () => {
    const { cookie } = await signInAsNew({ role: "super_admin" });
    const res = await POST(exportRequest({ cookie }));
    expect(res.status).toBe(200);
    expect(records(await res.text()).length).toBe((await listToolsForExport()).length + 1);
  });

  it("exports only the selected ids", async () => {
    const { cookie } = await signInAsNew({ role: "super_admin" });
    const all = await listToolsForExport();
    const chosen = all[all.length - 1];

    const res = await POST(exportRequest({ cookie, body: { ids: [chosen.id] } }));

    expect(res.status).toBe(200);
    const lines = records(await res.text());
    expect(lines).toHaveLength(2);
    expect(lines[1].startsWith(`${chosen.id},${chosen.slug},`)).toBe(true);
  });

  it("answers 400 for a body it does not understand", async () => {
    const { cookie } = await signInAsNew({ role: "super_admin" });
    for (const body of [{ ids: "all" }, { ids: [1, 2] }, { everything: true }]) {
      const res = await POST(exportRequest({ cookie, body }));
      expect(res.status).toBe(400);
    }
  });

  it("is bounded: the eleventh export in a minute is refused with Retry-After", async () => {
    const { cookie } = await signInAsNew({ role: "super_admin" });
    const ip = uniqueIp();
    for (let i = 0; i < 10; i += 1) {
      expect((await POST(exportRequest({ cookie, ip, body: { ids: [] } }))).status).toBe(200);
    }
    const res = await POST(exportRequest({ cookie, ip, body: { ids: [] } }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
