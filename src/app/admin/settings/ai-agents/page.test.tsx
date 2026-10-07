// @vitest-environment node
import { nextCacheMock } from "../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../../messages/en.json")).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }) };
});

import { isValidElement, type ReactElement } from "react";
import { AdminNotice } from "../../../../components/admin/AdminNotice";
import { AdminPageHeader, type AdminPageHeaderProps } from "../../../../components/admin/AdminPageHeader";
import { AllowanceGrant } from "../../../../components/admin/AllowanceGrant";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { resetDbForTests } from "../../../../lib/db/client";
import { signInAsNew } from "../../../../../test/utils/session";
import AdminAiAgentsPage from "./page";

/**
 * Settings › AI agents (admin sections spec 2026-10-07): `tools.edit` opens
 * it; the research budget's grant form, moved from the People roster, is
 * offered to a director (`users.manage`) only.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-ai-agents-page-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  vi.unstubAllEnvs();
});

function elements(node: unknown): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: unknown }).children)];
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: unknown; title?: unknown; body?: unknown };
  return [text(props.title), text(props.body), text(props.children)].join(" ");
}

const render = () => AdminAiAgentsPage() as Promise<ReactElement>;

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const person = await signInAsNew({ email, role });
  setMockHeaders({ cookie: person.cookie });
}

it("refuses an anonymous visitor and a student", async () => {
  setMockHeaders();
  expect((await render()).type).toBe(AdminNotice);
  await signIn("user", "casey-agents@cornell.edu");
  expect((await render()).type).toBe(AdminNotice);
});

it("shows a SuperMaker the agents and says directors grant the budget, with no grant form", async () => {
  await signIn("admin", "luis-agents@cornell.edu");
  const page = await render();
  const header = elements(page).find((el) => el.type === AdminPageHeader)?.props as AdminPageHeaderProps;
  expect(header.surface).toBe("agents");
  expect(header.title).toBe("AI agents");
  expect(elements(page).some((el) => el.type === AllowanceGrant)).toBe(false);
  const words = text(page);
  expect(words).toContain("Research agent");
  expect(words).toContain("Intake agent");
  expect(words).toContain("Directors (super admins) grant extra research items.");
});

it("gives a director the research budget's grant form", async () => {
  await signIn("super_admin", "niti-agents@cornell.edu");
  const page = await render();
  const grant = elements(page).find((el) => el.type === AllowanceGrant);
  expect(grant).toBeDefined();
  const candidates = (grant?.props as { candidates: { email: string }[] }).candidates;
  expect(candidates.some((person) => person.email === "niti-agents@cornell.edu")).toBe(true);
});
