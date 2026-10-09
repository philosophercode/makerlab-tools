// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
const redirect = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`redirect:${href}`);
  })
);
vi.mock("next/navigation", () => ({ redirect }));

import type { ReactElement } from "react";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { resetAuthForTests } from "../../../lib/auth/config";
import { resetDbForTests } from "../../../lib/db/client";
import { signInAsNew } from "../../../../test/utils/session";
import AdminPeoplePage from "./page";

/**
 * `/admin/people` (admin sections spec 2026-10-07): the People section's own
 * address sends each role to the first People page it may open.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-people-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  redirect.mockClear();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  vi.unstubAllEnvs();
});

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const person = await signInAsNew({ email, role });
  setMockHeaders({ cookie: person.cookie });
}

it("sends a director to the roster", async () => {
  await signIn("super_admin", "niti-people@cornell.edu");
  await expect(AdminPeoplePage()).rejects.toThrow("redirect:/admin/users");
});

it("sends a SuperMaker to Student projects, never the roster", async () => {
  await signIn("admin", "luis-people@cornell.edu");
  await expect(AdminPeoplePage()).rejects.toThrow("redirect:/admin/projects");
});

it("refuses a student in words", async () => {
  await signIn("user", "casey-people@cornell.edu");
  const page = (await AdminPeoplePage()) as ReactElement;
  expect(page.type).toBe(AdminNotice);
  expect(redirect).not.toHaveBeenCalled();
});
