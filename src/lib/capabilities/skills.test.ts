// @vitest-environment node
import { eq } from "drizzle-orm";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import type { Identity } from "../auth/identity";
import { readsOutsideContent } from "../chat/taint";
import { getDb, resetDbForTests } from "../db/client";
import { tools, toolSkills } from "../db/schema/index";
import { capabilitiesForIdentity } from "./access";
import { catalog } from "./catalog";
import { toAiTools } from "./chat-adapter";
import { CAPABILITIES } from "./index";
import { audienceOf } from "./mcp-catalog";
import { mcpToolsFor } from "./mcp-access";
import { skills, SKILL_READER_NOTE } from "./skills";
import type { CapabilityCtx, CapabilityTool } from "./types";

vi.mock("next/cache", () => nextCacheMock());

/**
 * `get_tool_skill` (tool skills spec 2026-10-07 §5.5) against the demo seed:
 * the current (latest ready) skill as fenced markdown with its sources, for
 * the same audience as `get_tool_details` — published tools for everyone,
 * drafts for staff — in the chat and over MCP; and the pointer
 * `get_tool_details` gains when a skill exists.
 */

const getToolSkill = skills.tools[0] as CapabilityTool<{ id_or_name: string }, Record<string, unknown>>;
const getToolDetails = catalog.tools.find((tool) => tool.name === "get_tool_details") as CapabilityTool<{ id_or_name: string }, Record<string, unknown>>;

function ctxFor(role: Identity["role"]): CapabilityCtx {
  return {
    identity: { role, userId: role === "anonymous" ? null : `user-${role}`, email: null, name: null, rateLimitKey: "test" } as Identity,
  };
}

const SECTIONS = {
  format: 1,
  quickFacts: [{ text: "An SLA printer", cites: ["T1"], origin: "model" }],
  beforeYouStart: [],
  operatingProcedure: [{ text: "Shake the cartridge", cites: ["M1"], origin: "model" }],
  settingsAndLimits: [],
  materials: [],
  troubleshooting: [],
  safety: [{ text: "Emergency stop: not in the lab's sources. Ask staff where it is before you start.", cites: [], origin: "lab" }],
  whenToGetStaff: [],
  notInSources: [],
  removed: [],
  unknownCites: [],
};
const SOURCES = [
  { id: "T1", kind: "catalog", toolName: "Form 4" },
  { id: "M1", kind: "manual", documentId: "00000000-0000-4000-8000-0000000000aa", title: "Form 4 Manual", pageStart: 12, pageEnd: 13, section: ["Printing"] },
  { id: "K1", kind: "link", title: "Formlabs support", type: "Other", url: "https://support.formlabs.example" },
];

async function toolIdOf(slug: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, slug));
  return row.id;
}

async function seedSkill(toolId: string, version: number, status: "ready" | "failed" = "ready") {
  const db = await getDb();
  await db.insert(toolSkills).values({
    toolId,
    version,
    status,
    content: status === "ready" ? `---\nname: "form-4"\n---\n\n# Form 4: operating guide v${version}\n` : "",
    sections: status === "ready" ? SECTIONS : {},
    sources: status === "ready" ? SOURCES : [],
    inputHash: `sha256:${version}`,
    model: "openai/gpt-6-luna",
    trigger: "manual",
    error: status === "failed" ? "The model could not answer (rate_limited)." : null,
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  resetDbForTests();
  vi.unstubAllEnvs();
});

describe("get_tool_skill", () => {
  it("returns the current skill, fenced, with its sources and the safety note — a later failed attempt never hides it", async () => {
    const formId = await toolIdOf("form-4");
    await seedSkill(formId, 1);
    await seedSkill(formId, 2, "failed");

    const result = await getToolSkill.run({ id_or_name: "form-4" }, ctxFor("anonymous"));
    expect(result).toMatchObject({
      found: true,
      tool: { id: formId, slug: "form-4", name: "Form 4", detail_page: "/tools/form-4" },
      skill: { version: 1, model: "openai/gpt-6-luna", note: SKILL_READER_NOTE },
    });
    const skill = result.skill as { skill_markdown: string; sources: unknown[]; generated_at: string };
    expect(skill.skill_markdown).toMatch(/^<untrusted-page id="[0-9a-f]+" source="tool skill: Form 4, version 1">/);
    expect(skill.skill_markdown).toContain("# Form 4: operating guide v1");
    expect(new Date(skill.generated_at).toString()).not.toBe("Invalid Date");
    expect(skill.sources).toEqual([
      { id: "T1", kind: "catalog", title: "The lab's catalogue record for the Form 4" },
      { id: "M1", kind: "manual", title: "Form 4 Manual", document_id: "00000000-0000-4000-8000-0000000000aa", pages: "12–13", section: "Printing" },
      { id: "K1", kind: "link", title: "Formlabs support", url: "https://support.formlabs.example" },
    ]);
  });

  it("finds a tool by name too, and says when it has no skill yet", async () => {
    const result = await getToolSkill.run({ id_or_name: "Trotec" }, ctxFor("anonymous"));
    expect(result).toMatchObject({ found: true, tool: { slug: "trotec-speedy-400" }, skill: null });
    expect(result.message).toMatch(/No skill has been written for the Trotec Speedy 400 yet/);
    expect(await getToolSkill.run({ id_or_name: "no such machine" }, ctxFor("anonymous"))).toMatchObject({ found: false });
  });

  it("serves a draft's skill to staff only, like get_tool_details", async () => {
    const formId = await toolIdOf("form-4");
    await seedSkill(formId, 1);
    const db = await getDb();
    await db.update(tools).set({ published: false }).where(eq(tools.id, formId));

    expect(await getToolSkill.run({ id_or_name: "form-4" }, ctxFor("anonymous"))).toMatchObject({ found: false });
    expect(await getToolSkill.run({ id_or_name: "form-4" }, ctxFor("user"))).toMatchObject({ found: false });
    expect(await getToolSkill.run({ id_or_name: "form-4" }, ctxFor("admin"))).toMatchObject({ found: true, skill: { version: 1 } });
  });

  it("is offered to everybody, in the chat and over MCP, and reading it taints the turn", () => {
    expect(Object.keys(toAiTools(capabilitiesForIdentity(CAPABILITIES, { role: "anonymous" }), {}))).toContain("get_tool_skill");
    const anonymous = mcpToolsFor(CAPABILITIES, { identity: { role: "anonymous" } as never, readOnly: true }).map(({ tool }) => tool.name);
    expect(anonymous).toContain("get_tool_skill");
    expect(audienceOf(skills, getToolSkill as CapabilityTool<unknown, unknown>)).toBe("anyone");
    expect(getToolSkill.kind).toBe("read");
    expect(readsOutsideContent("get_tool_skill")).toBe(true);
  });

  it("tells the chat model when to call it, in the stable prefix", () => {
    const fragment = skills.promptFragment({ tools: [] });
    expect(fragment).toContain("get_tool_skill");
    expect(fragment).toMatch(/not\*\* on its page/);
    expect(fragment).toMatch(/never `search_manual` refs/);
  });
});

describe("get_tool_details' pointer", () => {
  it("names get_tool_skill when the tool has a skill, and says nothing when it has none", async () => {
    expect(await getToolDetails.run({ id_or_name: "form-4" }, ctxFor("anonymous"))).not.toHaveProperty("skill");
    await seedSkill(await toolIdOf("form-4"), 1);
    const details = await getToolDetails.run({ id_or_name: "form-4" }, ctxFor("anonymous"));
    expect(details.skill).toMatch(/version 1\): call get_tool_skill/);
  });
});
