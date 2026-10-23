// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));

import { isValidElement, type ReactElement } from "react";
import { UsersTable } from "../../../components/admin/UsersTable";
import { resetAuthForTests } from "../../../lib/auth/config";
import { resetDbForTests } from "../../../lib/db/client";
import { isSamplePerson } from "../../../lib/demo-admin/sample-people";
import type { UserRecord } from "../../../lib/data/users";
import { signInAsNew } from "../../../../test/utils/session";
import AdminUsersPage from "./page";

/**
 * `/admin/users` for the demo identity (demo admin spec 2026-10-11 §6, §7, and
 * the amendment "A read-only public admin", 2026-10-22): the booth demo sees
 * the stored roster with the sample people appended; the read-only public demo
 * (`DEMO_ADMIN=view`) sees the sample people alone, never a stored person.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-users-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
  resetDbForTests();
});

const render = () => AdminUsersPage({ searchParams: Promise.resolve({}) }) as Promise<ReactElement>;

/** Every element in a server-rendered tree, depth first. */
function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  return [node, ...elements(props.children)];
}

async function rosterSeenSignedOut(): Promise<UserRecord[]> {
  // A real person in the roster, then a visitor with no session.
  await signInAsNew({ email: "real.student@cornell.edu", role: "user" });
  setMockHeaders();
  const table = elements(await render()).find((el) => el.type === UsersTable);
  expect(table).toBeDefined();
  return (table!.props as { users: UserRecord[] }).users;
}

it("shows the booth demo the stored roster with the twenty sample people appended", async () => {
  vi.stubEnv("DEMO_ADMIN", "1");
  const users = await rosterSeenSignedOut();
  expect(users.some((person) => person.email === "real.student@cornell.edu")).toBe(true);
  expect(users.filter((person) => isSamplePerson(person.id))).toHaveLength(20);
});

it("shows the read-only public demo the sample people only", async () => {
  vi.stubEnv("DEMO_ADMIN", "view");
  const users = await rosterSeenSignedOut();
  expect(users).toHaveLength(20);
  expect(users.every((person) => isSamplePerson(person.id))).toBe(true);
});
