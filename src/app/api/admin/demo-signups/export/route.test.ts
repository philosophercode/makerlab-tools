// @vitest-environment node
/**
 * `GET /api/admin/demo-signups/export` (demo pass spec 2026-10-07 §5.6): the
 * sign-ups CSV for super admins only, and every download in the audit trail.
 */
import { resetAuthForTests } from "@/lib/auth/config";
import { listAuditEvents } from "@/lib/data/audit";
import { findOrCreateDemoSignup } from "@/lib/data/demo-signups";
import { resetDbForTests } from "@/lib/db/client";
import { signInAsNew } from "../../../../../../test/utils/session";
import { GET } from "./route";

function download(cookie?: string): Promise<Response> {
  return GET(new Request("http://localhost/api/admin/demo-signups/export", { headers: { "x-forwarded-for": "192.0.2.200", ...(cookie ? { cookie } : {}) } }));
}

beforeAll(async () => {
  vi.stubEnv("AUTH_SECRET", "demo-signups-export-secret");
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  await findOrCreateDemoSignup({
    name: "Ada Lovelace",
    email: "ada.export@example.org",
    institution: "Analytical Engines Lab",
    role: "faculty",
    runsMakerspace: true,
    useCase: null,
    consentToContact: true,
    passExpiresAt: new Date(Date.now() + 86_400_000),
  });
});

beforeEach(() => {
  // `vitest.setup.ts` clears env stubs after every test, so each one sets its own.
  vi.stubEnv("AUTH_SECRET", "demo-signups-export-secret");
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
  resetDbForTests();
});

describe("GET /api/admin/demo-signups/export", () => {
  it("refuses a visitor (401) and anybody without users.manage (403)", async () => {
    expect((await download()).status).toBe(401);
    for (const role of ["user", "admin"] as const) {
      const { cookie } = await signInAsNew({ role });
      const res = await download(cookie);
      expect(res.status).toBe(403);
      expect(await res.text()).not.toContain("ada.export@example.org");
    }
  });

  it("hands a super admin the CSV, uncached, and records the download", async () => {
    const { cookie, user } = await signInAsNew({ role: "super_admin", name: "Dee Rector" });
    const res = await download(cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="demo-signups-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const csv = await res.text();
    expect(csv).toContain("ada.export@example.org");
    expect(csv).toContain("May contact");

    const events = await listAuditEvents();
    expect(events.find((event) => event.action === "demo_signups.exported" && event.actorUserId === user.id)).toMatchObject({
      subjectType: "demo_signups",
      subjectId: "all",
    });
  });
});
