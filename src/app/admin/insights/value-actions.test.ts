// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission, to prove the action asks for its own (`insights.configure`). */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions ? override.permissions.has(permission) : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { INSIGHTS_SET_VALUE_ASSUMPTIONS } from "../../../lib/actions/insights";
import { resetAuthForTests } from "../../../lib/auth/config";
import { can } from "../../../lib/auth/permissions";
import { getLabSetting, VALUE_REPORT_SETTING } from "../../../lib/data/lab-settings";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { labSettings, session } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { defaultAssumptions, type ValueAssumptions } from "../../../lib/usage/value/assumptions";
import { signInAsNew } from "../../../../test/utils/session";
import { saveValueAssumptions } from "./actions";

/**
 * `saveValueAssumptions` (usage insight spec amendment "Value report"): called
 * directly, as a server action can be, so `performAction`'s gate — signed in,
 * then `insights.configure` — and the definition's schema are all that stand
 * in front of the write.
 */

let db: Db;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "value-assumptions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  db = await getDb();
  await db.delete(labSettings);
  await db.delete(session);
});

afterEach(() => {
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
});

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const signedIn = await signInAsNew({ email, role });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

const changed = (): ValueAssumptions => ({ ...defaultAssumptions("LAB OPEN 8AM-8PM"), minutesPerQuestion: 5, hourlyCost: 45.5 });

it("is granted to admins and super admins, and nobody else", () => {
  expect(can({ role: "admin" }, "insights.configure")).toBe(true);
  expect(can({ role: "super_admin" }, "insights.configure")).toBe(true);
  expect(can({ role: "user" }, "insights.configure")).toBe(false);
  expect(can({ role: "anonymous" }, "insights.configure")).toBe(false);
});

it("refuses an anonymous caller and a student, storing nothing", async () => {
  setMockHeaders();
  expect(await saveValueAssumptions(changed())).toEqual({ ok: false, error: "not_signed_in" });
  await signIn("user", "casey@cornell.edu");
  expect(await saveValueAssumptions(changed())).toEqual({ ok: false, error: "not_permitted" });
  expect(await getLabSetting(VALUE_REPORT_SETTING)).toBeNull();
});

it("asks for insights.configure, not insights.view", async () => {
  await signIn("admin", "niti@cornell.edu");
  override.permissions = new Set(["insights.view"]);
  expect(await saveValueAssumptions(changed())).toEqual({ ok: false, error: "not_permitted" });
  override.permissions = new Set(["insights.configure"]);
  expect(await saveValueAssumptions(changed())).toEqual({ ok: true });
});

it("stores the assumptions, normalised, with who set them", async () => {
  const admin = await signIn("admin", "niti@cornell.edu");
  const input = { ...changed(), staffedHours: { days: [5, 1, 3], openHour: 9, closeHour: 18 } };
  expect(await saveValueAssumptions(input)).toEqual({ ok: true });
  const [row] = await db.select().from(labSettings);
  expect(row).toMatchObject({ key: VALUE_REPORT_SETTING, updatedBy: admin.user.id });
  expect(row.value).toMatchObject({ minutesPerQuestion: 5, hourlyCost: 45.5, staffedHours: { days: [1, 3, 5], openHour: 9, closeHour: 18 } });
  expect((await getLabSetting(VALUE_REPORT_SETTING))?.updatedByName).toBeTruthy();
});

it.each([
  ["minutes out of range", { minutesPerQuestion: 0 }],
  ["a negative cost", { hourlyCost: -5 }],
  ["overlapping terms", { terms: [{ kind: "spring", start: "01-01", end: "09-01" }, { kind: "summer", start: "05-21", end: "08-20" }, { kind: "fall", start: "08-21", end: "12-31" }] }],
  ["a field that is not a number", { mcpCallsPerQuestion: "two" }],
])("refuses %s with invalid_field, storing nothing", async (_name, patch) => {
  await signIn("super_admin", "luis@cornell.edu");
  expect(await saveValueAssumptions({ ...changed(), ...patch } as unknown as ValueAssumptions)).toEqual({ ok: false, error: "invalid_field" });
  expect(await getLabSetting(VALUE_REPORT_SETTING)).toBeNull();
});

it("is GUI only: the assistant never offers it, and MCP never sees it", () => {
  expect(INSIGHTS_SET_VALUE_ASSUMPTIONS).toMatchObject({ assistant: "never", mcp: "never", permission: "insights.configure" });
  expect(INSIGHTS_SET_VALUE_ASSUMPTIONS.tool).toBeUndefined();
  expect(INSIGHTS_SET_VALUE_ASSUMPTIONS.preview).toBeUndefined();
});
