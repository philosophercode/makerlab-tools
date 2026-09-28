// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) => (values ? `${key} ${JSON.stringify(values)}` : key),
}));

import { isValidElement, type ReactElement } from "react";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { UnansweredQueue } from "../../../components/admin/insights/UnansweredQueue";
import { resetAuthForTests } from "../../../lib/auth/config";
import { resetDbForTests } from "../../../lib/db/client";
import { signInAsNew } from "../../../../test/utils/session";
import AdminInsightsPage from "./page";

/**
 * `/admin/insights`' own gate (usage insight spec §8): `insights.view`, which
 * admins and super admins hold. Everyone else gets the admin area's
 * "not permitted" notice — never the counts, never a 500. The layout's coarse
 * gate is covered by the admin layout's tests; this is the page's own.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-insights-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

const render = () => AdminInsightsPage({ searchParams: Promise.resolve({}) }) as Promise<ReactElement>;

/** Every element in a server-rendered tree, depth first. */
function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: unknown };
  return [node, ...elements(props.children)];
}

it("refuses an anonymous visitor with the not-permitted notice", async () => {
  setMockHeaders();
  const page = await render();
  expect(page.type).toBe(AdminNotice);
  expect((page.props as { kind: string }).kind).toBe("forbidden");
});

it("refuses a signed-in student", async () => {
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });
  const page = await render();
  expect(page.type).toBe(AdminNotice);
});

it.each(["admin", "super_admin"] as const)("shows %s the counts and the Unanswered queue from the demo week", async (role) => {
  const person = await signInAsNew({ email: `${role}-insights@cornell.edu`, role });
  setMockHeaders({ cookie: person.cookie });
  const page = await render();
  expect(page.type).not.toBe(AdminNotice);
  const queue = elements(page).find((el) => el.type === UnansweredQueue);
  expect(queue).toBeDefined();
  const gaps = (queue!.props as { gaps: { question: string }[] }).gaps;
  expect(gaps.map((g) => g.question)).toContain("Do you have a waterjet cutter?");
});
