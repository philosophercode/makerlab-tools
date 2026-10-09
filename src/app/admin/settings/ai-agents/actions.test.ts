// @vitest-environment node
import { nextCacheMock } from "../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { revalidatePath } from "next/cache";
import { SKILLS_SET_AFTER_RESEARCH } from "../../../../lib/actions/skills";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { getLabSetting, TOOL_SKILLS_SETTING } from "../../../../lib/data/lab-settings";
import { getDb, resetDbForTests } from "../../../../lib/db/client";
import { labSettings, session } from "../../../../lib/db/schema/index";
import { skillsAfterResearch } from "../../../../lib/skills/setting";
import { signInAsNew } from "../../../../../test/utils/session";
import { AI_AGENTS_PATH } from "./action-result";
import { setSkillWriting } from "./actions";

/**
 * "Write a tool skill after research" (tool skills spec 2026-10-07 §4.4, §6):
 * off until a director turns it on; `users.manage` only; the row records who
 * set it; the page refreshes.
 */

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "skill-writing-action-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  vi.mocked(revalidatePath).mockClear();
  const db = await getDb();
  await db.delete(labSettings);
  await db.delete(session);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
  vi.unstubAllEnvs();
});

async function signIn(role: "user" | "admin" | "super_admin", email: string) {
  const signedIn = await signInAsNew({ email, role });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

it("is off by default", async () => {
  expect(await skillsAfterResearch()).toBe(false);
});

it("refuses an anonymous caller, a student and a SuperMaker: it is a director's", async () => {
  setMockHeaders();
  expect(await setSkillWriting({ afterResearch: true })).toEqual({ ok: false, error: "not_signed_in" });
  await signIn("user", "casey-skills@cornell.edu");
  expect(await setSkillWriting({ afterResearch: true })).toEqual({ ok: false, error: "not_permitted" });
  await signIn("admin", "luis-skills@cornell.edu");
  expect(await setSkillWriting({ afterResearch: true })).toEqual({ ok: false, error: "not_permitted" });
  expect(await skillsAfterResearch()).toBe(false);
});

it("lets a director turn it on and off, recording who set it and refreshing the page", async () => {
  const director = await signIn("super_admin", "niti-skills@cornell.edu");
  expect(await setSkillWriting({ afterResearch: true })).toEqual({ ok: true });
  expect(await skillsAfterResearch()).toBe(true);
  const db = await getDb();
  const [row] = await db.select().from(labSettings);
  expect(row).toMatchObject({ key: TOOL_SKILLS_SETTING, value: { afterResearch: true }, updatedBy: director.user.id });
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(AI_AGENTS_PATH);

  expect(await setSkillWriting({ afterResearch: false })).toEqual({ ok: true });
  expect(await skillsAfterResearch()).toBe(false);
});

it("refuses anything but a boolean, storing nothing", async () => {
  await signIn("super_admin", "niti-skills@cornell.edu");
  expect(await setSkillWriting({ afterResearch: "yes" } as never)).toEqual({ ok: false, error: "invalid_field" });
  expect(await setSkillWriting({} as never)).toEqual({ ok: false, error: "invalid_field" });
  expect(await getLabSetting(TOOL_SKILLS_SETTING)).toBeNull();
});

it("reads a stored value that no longer parses as off", async () => {
  const db = await getDb();
  await db.insert(labSettings).values({ key: TOOL_SKILLS_SETTING, value: { afterResearch: "maybe" } });
  expect(await skillsAfterResearch()).toBe(false);
});

it("is GUI only: the assistant never offers it, and MCP never sees it", () => {
  expect(SKILLS_SET_AFTER_RESEARCH).toMatchObject({ id: "skills.set_after_research", assistant: "never", mcp: "never", permission: "users.manage" });
  expect(SKILLS_SET_AFTER_RESEARCH.tool).toBeUndefined();
});
