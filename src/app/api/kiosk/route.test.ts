// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
// The real loader, watched: the limiter test asserts it was never reached, and
// the outage test makes it fail once.
vi.mock("../../../lib/kiosk/snapshot", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/kiosk/snapshot")>();
  return { ...actual, loadKioskSnapshot: vi.fn(actual.loadKioskSnapshot) };
});

import { startShift } from "../../../lib/data/staff-shifts";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { staffShifts } from "../../../lib/db/schema/index";
import { insertUserRow } from "../../../../test/utils/session";
import { loadKioskSnapshot } from "../../../lib/kiosk/snapshot";
import type { KioskResponse } from "../../../lib/kiosk/types";
import { ROUTE_TIERS } from "../../../lib/rate-limit";
import { GET } from "./route";

/**
 * `GET /api/kiosk` (kiosk spec §10, integration layer): the snapshot's shape,
 * the limiter ahead of any query, and a failing database answered with 503 —
 * never a zeroed snapshot.
 */

// The in-memory limiter is a per-process singleton keyed by IP, so every test
// gets its own address.
let ipCounter = 0;
function makeRequest(ip = `10.20.0.${++ipCounter}`, extraHeaders: Record<string, string> = {}) {
  return new Request("https://makerlab-ai.vercel.app/api/kiosk", {
    headers: { "x-forwarded-for": ip, host: "makerlab-ai.vercel.app", "x-forwarded-proto": "https", ...extraHeaders },
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("PGLITE_DATA_DIR", "");
  vi.mocked(loadKioskSnapshot).mockClear();
});

afterEach(() => {
  resetDbForTests();
  vi.unstubAllEnvs();
});

describe("GET /api/kiosk", () => {
  it("answers 200 with the snapshot, never to be stored by a cache in between", async () => {
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as KioskResponse;
    expect(Object.keys(body).sort()).toEqual(
      ["askUrl", "demo", "down", "featured", "generatedAt", "lab", "onShift", "servedAt", "tickets", "unitsInService"].sort()
    );
    expect(body.askUrl).toBe("https://makerlab-ai.vercel.app/?src=kiosk&ask=1");
    expect(body.demo).toBe(true);
    expect(body.tickets).toEqual({ open: 1, inProgress: 0 });
    expect(Number.isNaN(Date.parse(body.servedAt))).toBe(false);
  });

  it("says who is on shift by first name and initial, and nobody once the shift has ended (on-shift spec 2026-10-07)", async () => {
    const db = await getDb();
    const alex = await insertUserRow(db, { name: "Alex Morgan", role: "admin", email: "alex.kiosk@cornell.edu" });
    const sam = await insertUserRow(db, { name: "Sam Lee", role: "admin", email: "sam.kiosk@cornell.edu" });
    await startShift(alex.id, new Date(Date.now() + 3_600_000), { db });
    await startShift(sam.id, new Date(Date.now() - 60_000), { db });
    try {
      const body = (await (await GET(makeRequest())).json()) as KioskResponse;
      expect(body.onShift).toEqual(["Alex M."]);
      // The full name and the address never reach the screen.
      expect(JSON.stringify(body)).not.toContain("Morgan");
      expect(JSON.stringify(body)).not.toContain("alex.kiosk@");
    } finally {
      await db.delete(staffShifts);
    }
    const after = (await (await GET(makeRequest())).json()) as KioskResponse;
    expect(after.onShift).toEqual([]);
  });

  it("reads no cookie and sets none", async () => {
    const res = await GET(makeRequest(undefined, { cookie: "better-auth.session_token=whatever" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("answers 429 past the kiosk tier, before it reads anything", async () => {
    const ip = "10.20.99.1";
    for (let i = 0; i < ROUTE_TIERS.kiosk.limit; i++) {
      expect((await GET(makeRequest(ip))).status).toBe(200);
    }
    vi.mocked(loadKioskSnapshot).mockClear();

    const res = await GET(makeRequest(ip));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(loadKioskSnapshot).not.toHaveBeenCalled();
    // Another address is its own window: one screen cannot starve another.
    expect((await GET(makeRequest("10.20.99.2"))).status).toBe(200);
  });

  it("answers 503 with no snapshot at all when the database cannot be read, and leaks nothing", async () => {
    vi.mocked(loadKioskSnapshot).mockRejectedValueOnce(new Error("connection terminated (postgres://secret@db.internal)"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(makeRequest());

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("secret");
  });
});
