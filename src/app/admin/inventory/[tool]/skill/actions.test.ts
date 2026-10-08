// @vitest-environment node
import { nextCacheMock } from "../../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission, to prove the action asks for its own (`tools.edit`). */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions ? override.permissions.has(permission) : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

// The skill run is mocked at its `start()` module: nothing here writes a skill.
const runs = vi.hoisted(() => ({ startToolSkills: vi.fn() }));
vi.mock("../../../../../lib/skills/start", () => ({ startToolSkills: runs.startToolSkills }));

import { eq } from "drizzle-orm";
import { SKILLS_WRITE } from "../../../../../lib/actions/skills";
import { resetAuthForTests } from "../../../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../../../lib/db/client";
import { session, tools, toolSkills } from "../../../../../lib/db/schema/index";
import type { Db } from "../../../../../lib/db/types";
import { SKILL_DAILY_LIMIT } from "../../../../../lib/skills/limits";
import { signInAsNew } from "../../../../../../test/utils/session";
import { toolSkillPath } from "./action-result";
import { writeSkill } from "./actions";

/**
 * **Write skill** (tool skills spec 2026-10-07 §6): `writeSkill` called
 * directly, as a server action can be, so `performAction`'s gate — signed in,
 * then `tools.edit` — and the definition's checks are all that stand in front
 * of the run it starts.
 */

let db: Db;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "tool-skill-action-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  runs.startToolSkills.mockReset().mockResolvedValue(true);
  db = await getDb();
  await db.delete(toolSkills);
  await db.delete(session);
});

afterEach(() => {
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
  vi.unstubAllEnvs();
});

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const signedIn = await signInAsNew({ email, role });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

/** The demo Form 4: it has lab notes, so there is something to write from. */
async function formId(): Promise<string> {
  const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  return row.id;
}

it("refuses an anonymous caller and a student, starting nothing", async () => {
  const toolId = await formId();
  setMockHeaders();
  expect(await writeSkill({ toolId })).toEqual({ ok: false, error: "not_signed_in" });
  await signIn("user", "casey-skill@cornell.edu");
  expect(await writeSkill({ toolId })).toEqual({ ok: false, error: "not_permitted" });
  expect(runs.startToolSkills).not.toHaveBeenCalled();
});

it("asks for tools.edit, the editor's permission", async () => {
  const toolId = await formId();
  await signIn("admin", "luis-skill@cornell.edu");
  override.permissions = new Set(["tools.add", "insights.configure"]);
  expect(await writeSkill({ toolId })).toEqual({ ok: false, error: "not_permitted" });
  override.permissions = new Set(["tools.edit"]);
  expect(await writeSkill({ toolId })).toEqual({ ok: true });
});

it("starts a forced manual run for that tool", async () => {
  const toolId = await formId();
  await signIn("admin", "luis-skill@cornell.edu");
  expect(await writeSkill({ toolId })).toEqual({ ok: true });
  expect(runs.startToolSkills).toHaveBeenCalledWith([toolId], "manual", true);
});

it("refuses an unknown or archived tool, and a tool with nothing to write from", async () => {
  await signIn("admin", "luis-skill@cornell.edu");
  expect(await writeSkill({ toolId: "00000000-0000-4000-8000-000000000000" })).toEqual({ ok: false, error: "not_found" });
  expect(await writeSkill({ toolId: 42 } as never)).toEqual({ ok: false, error: "not_found" });
  const [bare] = await db.insert(tools).values({ name: "Bench vise", slug: "bench-vise-skill", published: true }).returning({ id: tools.id });
  expect(await writeSkill({ toolId: bare.id })).toEqual({ ok: false, error: "nothing_to_write" });
  const toolId = await formId();
  await db.update(tools).set({ archivedAt: new Date() }).where(eq(tools.id, toolId));
  expect(await writeSkill({ toolId })).toEqual({ ok: false, error: "not_found" });
  expect(runs.startToolSkills).not.toHaveBeenCalled();
});

it("refuses once the lab has written today's limit of skills", async () => {
  const toolId = await formId();
  await db.insert(toolSkills).values(
    Array.from({ length: SKILL_DAILY_LIMIT }, (_, i) => ({ toolId, version: i + 1, status: "failed", inputHash: "x", model: "m", trigger: "research" }))
  );
  await signIn("admin", "luis-skill@cornell.edu");
  expect(await writeSkill({ toolId })).toEqual({ ok: false, error: "skill_daily_limit" });
  expect(runs.startToolSkills).not.toHaveBeenCalled();
});

it("says so when the run could not be started", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  runs.startToolSkills.mockResolvedValue(false);
  await signIn("admin", "luis-skill@cornell.edu");
  expect(await writeSkill({ toolId: await formId() })).toEqual({ ok: false, error: "start_failed" });
});

it("is GUI only and spend: the assistant never offers it, and MCP never sees it", () => {
  expect(SKILLS_WRITE).toMatchObject({ id: "skills.write", toolName: "write_tool_skill", assistant: "never", mcp: "never", permission: "tools.edit", risk: "spend" });
  expect(SKILLS_WRITE.tool).toBeUndefined();
  expect(SKILLS_WRITE.preview).toBeUndefined();
  expect(toolSkillPath("form-4")).toBe("/admin/inventory/form-4/skill");
});
