// @vitest-environment node
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/headers", () => nextHeadersMock());

import { resetAuthForTests } from "../auth/config";
import { resetDbForTests } from "../db/client";
import { signInAsNew } from "../../../test/utils/session";
import { authorizeAdminAction } from "./action-gate";

/**
 * The preamble every admin server action shares (spec §8).
 *
 * Called directly, with no page anywhere — which is the point: a server action
 * is a POST endpoint, and this is the only thing standing in front of one.
 */

const AUTH_SECRET = "action-gate-test-secret";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

it("refuses an anonymous caller with the code that says so", async () => {
  setMockHeaders({ "x-forwarded-for": "198.51.100.11" });
  expect(await authorizeAdminAction("tools.edit")).toEqual({
    ok: false,
    error: "not_signed_in",
  });
});

it("refuses a signed-in account that does not hold the permission", async () => {
  const student = await signInAsNew({ email: "student@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  // Told apart from `not_signed_in` on purpose: signing in again would not help.
  expect(await authorizeAdminAction("tools.edit")).toEqual({
    ok: false,
    error: "not_permitted",
  });
});

it("admits a SuperMaker and hands back the identity the action will stamp", async () => {
  const admin = await signInAsNew({ email: "maker@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: admin.cookie });

  const gate = await authorizeAdminAction("tools.edit");
  expect(gate.ok).toBe(true);
  if (!gate.ok) return;
  expect(gate.identity.userId).toBe(admin.user.id);
});

it("checks each permission separately, so holding one is not holding another", async () => {
  const admin = await signInAsNew({ email: "maker2@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: admin.cookie });

  expect((await authorizeAdminAction("tools.edit")).ok).toBe(true);
  expect(await authorizeAdminAction("users.manage")).toEqual({
    ok: false,
    error: "not_permitted",
  });
});

it("spends the limiter before the permission check, so a refusal is not free", async () => {
  // 120/min per key (§8). The limiter is a per-process singleton and an
  // anonymous caller is keyed by a hash of their IP, so this needs an address
  // no other test in the file shares — otherwise it inherits their allowance.
  setMockHeaders({ "x-forwarded-for": "198.51.100.23" });

  // Every call is refused on the permission check until the 121st, which is
  // refused *before* it: that ordering is what stops a refusal being free.
  const errors: string[] = [];
  for (let i = 0; i < 121; i += 1) {
    const gate = await authorizeAdminAction("tools.edit");
    if (!gate.ok) errors.push(gate.error);
  }

  expect(errors.slice(0, 120).every((error) => error === "not_signed_in")).toBe(true);
  expect(errors[120]).toBe("rate_limited");
});
