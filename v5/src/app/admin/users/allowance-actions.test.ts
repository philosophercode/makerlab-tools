// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { and, eq } from "drizzle-orm";
import { signInAsNew } from "../../../../test/utils/session";
import { resetAuthForTests } from "../../../lib/auth/config";
import { researchLimitFor } from "../../../lib/data/research-allowances";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents } from "../../../lib/db/schema/index";
import { grantSetupAllowance } from "./allowance-actions";

/**
 * **Grant a setup allowance** (bulk intake spec §4.2, §8): a super admin only,
 * to somebody who can add equipment, bounded, and audited.
 */

const AUTH_SECRET = "allowance-actions-test-secret";
let counter = 0;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function person(role: "user" | "admin" | "super_admin") {
  counter += 1;
  return signInAsNew({ email: `allowance-${counter}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
}

describe("grantSetupAllowance", () => {
  it("lets a super admin raise an admin's ceiling, and records it", async () => {
    const loader = await person("admin");
    const director = await person("super_admin");
    setMockHeaders({ cookie: director.cookie });

    const result = await grantSetupAllowance({ userId: loader.user.id, extraItems: 400, days: 7 });
    expect(result.ok).toBe(true);
    expect(await researchLimitFor(loader.user.id)).toBe(500);

    const db = await getDb();
    const [event] = await db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "allowance.granted"), eq(auditEvents.subjectId, loader.user.id)));
    expect(event).toMatchObject({ actorUserId: director.user.id, subjectType: "user", detail: expect.objectContaining({ extraItems: 400, days: 7 }) });
  });

  it("refuses an admin granting one, even to themselves", async () => {
    const admin = await person("admin");
    setMockHeaders({ cookie: admin.cookie });
    expect(await grantSetupAllowance({ userId: admin.user.id, extraItems: 400, days: 7 })).toEqual({ ok: false, error: "not_permitted" });
    expect(await researchLimitFor(admin.user.id)).toBe(100);
  });

  it("refuses a student target, an unknown one, and a grant past the bounds", async () => {
    const student = await person("user");
    const director = await person("super_admin");
    setMockHeaders({ cookie: director.cookie });
    expect(await grantSetupAllowance({ userId: student.user.id, extraItems: 400, days: 7 })).toEqual({ ok: false, error: "cannot_research" });
    expect(await grantSetupAllowance({ userId: "nobody", extraItems: 400, days: 7 })).toEqual({ ok: false, error: "unknown_user" });
    expect(await grantSetupAllowance({ userId: director.user.id, extraItems: 5000, days: 7 })).toEqual({ ok: false, error: "invalid_field" });
    expect(await grantSetupAllowance({ userId: director.user.id, extraItems: 400, days: 90 })).toEqual({ ok: false, error: "invalid_field" });
  });
});
