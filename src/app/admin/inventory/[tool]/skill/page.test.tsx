// @vitest-environment node
import { nextCacheMock } from "../../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../../../../../messages/en.json")).default;
  return { getTranslations: async (namespace: string) => createTranslator({ locale: "en", messages, namespace: namespace as never }) };
});

import { isValidElement, type ReactElement } from "react";
import { eq } from "drizzle-orm";
import { AdminNotice } from "../../../../../components/admin/AdminNotice";
import { AdminPageHeader, type AdminPageHeaderProps } from "../../../../../components/admin/AdminPageHeader";
import { ToolSkillView } from "../../../../../components/admin/skills/ToolSkillView";
import { ToolSkillWriteButton, type ToolSkillWriteButtonProps } from "../../../../../components/admin/skills/ToolSkillWriteButton";
import { EmptyState } from "../../../../../components/system/EmptyState";
import { resetAuthForTests } from "../../../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../../../lib/db/client";
import { tools, toolSkills } from "../../../../../lib/db/schema/index";
import { signInAsNew } from "../../../../../../test/utils/session";
import AdminToolSkillPage from "./page";

/**
 * A tool's skill page (tool skills spec 2026-10-07 §6): `tools.edit` opens it;
 * it shows the current skill with its facts, a failed later attempt, whether
 * it is out of date, and Write / Rewrite.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "tool-skill-page-secret");
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
  const props = node.props as { children?: unknown; actions?: unknown };
  return [node, ...elements(props.children), ...elements(props.actions)];
}

function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: unknown };
  return text(props.children);
}

const render = (slug: string) => AdminToolSkillPage({ params: Promise.resolve({ tool: slug }) }) as Promise<ReactElement>;

async function signIn(role: "user" | "admin") {
  const person = await signInAsNew({ email: `${role}-skill-page@cornell.edu`, role });
  setMockHeaders({ cookie: person.cookie });
}

async function seedSkill(version: number, status: "ready" | "failed", extra: Partial<typeof toolSkills.$inferInsert> = {}) {
  const db = await getDb();
  const [form] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  await db.insert(toolSkills).values({
    toolId: form.id,
    version,
    status,
    content: status === "ready" ? '---\nname: "form-4"\n---\n\n# Form 4: operating guide\n\n## Safety and emergency stop\n\n- Wear gloves [T1]\n' : "",
    sections: {},
    sources: status === "ready" ? [{ id: "T1", kind: "catalog", toolName: "Form 4" }] : [],
    inputHash: "sha256:old",
    model: "openai/gpt-6-luna",
    costUsd: 0.0031,
    trigger: "manual",
    error: status === "failed" ? "The model's answer could not be read as a skill." : null,
    ...extra,
  });
}

it("refuses a student", async () => {
  await signIn("user");
  expect((await render("form-4")).type).toBe(AdminNotice);
});

it("says when the tool is not in the inventory", async () => {
  await signIn("admin");
  const page = await render("no-such-tool");
  expect(elements(page).some((el) => el.type === EmptyState && text(el).includes("not in the inventory"))).toBe(true);
});

it("offers Write skill on a tool with none", async () => {
  await signIn("admin");
  const page = await render("form-4");
  const button = elements(page).find((el) => el.type === ToolSkillWriteButton)?.props as ToolSkillWriteButtonProps;
  expect(button).toMatchObject({ hasSkill: false, latestVersion: null });
  expect(elements(page).some((el) => el.type === EmptyState && text(el).includes("No skill yet"))).toBe(true);
});

it("shows the current skill with its facts, a later failed attempt, and that it is out of date", async () => {
  await seedSkill(1, "ready");
  await seedSkill(2, "failed");
  await signIn("admin");
  const page = await render("form-4");

  const header = elements(page).find((el) => el.type === AdminPageHeader)?.props as AdminPageHeaderProps;
  expect(header.title).toBe("Form 4");
  expect(header.facts).toEqual(expect.arrayContaining(["Version 1", "openai/gpt-6-luna", "$0.0031", "From Write skill", "Out of date"]));
  const button = elements(page).find((el) => el.type === ToolSkillWriteButton)?.props as ToolSkillWriteButtonProps;
  expect(button).toMatchObject({ hasSkill: true, latestVersion: 2 });
  const view = elements(page).find((el) => el.type === ToolSkillView)?.props as { content: string; sources: unknown[] };
  expect(view.content).toContain("# Form 4: operating guide");
  expect(view.sources).toHaveLength(1);
  const words = text(page);
  expect(words).toContain("The last attempt failed on");
  expect(words).toContain("The model's answer could not be read as a skill.");
  expect(words).toContain("Out of date: something it was written from has changed since.");
  expect(words).toContain("Skills are not written after research for this lab");
});
