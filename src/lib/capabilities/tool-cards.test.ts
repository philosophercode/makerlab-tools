// @vitest-environment node
import { eq } from "drizzle-orm";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { getDb, resetDbForTests } from "../db/client";
import { tools } from "../db/schema/index";
import { capabilitiesForIdentity } from "./access";
import { toAiTools } from "./chat-adapter";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";
import { showTool, toolCards } from "./tool-cards";
import type { CapabilityCtx } from "./types";

vi.mock("next/cache", () => nextCacheMock());

/**
 * `show_tool` (assistant–GUI parity spec, amendment 2026-10-07 "Images in the
 * chat") against the demo seed: published tools by slug or name become one
 * `data-tool-cards` part built from the catalogue; drafts, unknown names and
 * the tool on screen are skipped; once per reply; offered to everybody in the
 * chat and never over MCP.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  resetDbForTests();
  vi.unstubAllEnvs();
});

function writerCtx(extra: Partial<CapabilityCtx> = {}) {
  const write = vi.fn();
  const ctx = { writer: { write, merge: vi.fn(), onError: undefined }, ...extra } as unknown as CapabilityCtx;
  return { ctx, write };
}

async function toolIdOf(slug: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, slug));
  return row.id;
}

describe("show_tool", () => {
  it("draws a card per published tool, by slug or name, from the catalogue row", async () => {
    const { ctx, write } = writerCtx();
    const result = await showTool.run({ tools: ["form-4", "Trotec"] }, ctx);

    expect(result.shown).toEqual([
      { name: "Form 4", slug: "form-4" },
      { name: "Trotec Speedy 400", slug: "trotec-speedy-400" },
    ]);
    expect(write).toHaveBeenCalledOnce();
    const part = write.mock.calls[0][0];
    expect(part).toMatchObject({ type: "data-tool-cards", data: { kind: "tool-cards" } });
    const [form] = part.data.tools;
    expect(Object.keys(form).sort()).toEqual(["category", "imageSrc", "name", "slug", "status", "thumbnails"]);
    expect(form).toMatchObject({ slug: "form-4", name: "Form 4" });
    expect(["Available", "In Use", "Training Required", "Offline"]).toContain(form.status);
  });

  it("skips the tool whose page the person is on, and a name nothing matches", async () => {
    const { ctx, write } = writerCtx({ focusedToolId: await toolIdOf("form-4") });
    const result = await showTool.run({ tools: ["form-4", "no such machine", "trotec-speedy-400"] }, ctx);

    expect(result.shown.map((s) => s.slug)).toEqual(["trotec-speedy-400"]);
    expect(result.skipped).toEqual([
      { asked: "form-4", reason: "on_its_page" },
      { asked: "no such machine", reason: "not_found" },
    ]);
    expect(write.mock.calls[0][0].data.tools.map((c: { slug: string }) => c.slug)).toEqual(["trotec-speedy-400"]);
  });

  it("finds no draft, for staff too: a card links to a public page", async () => {
    const db = await getDb();
    await db.insert(tools).values({ slug: "draft-bandsaw", name: "Draft Bandsaw", published: false });
    const { ctx, write } = writerCtx();
    const result = await showTool.run({ tools: ["draft-bandsaw"] }, ctx);
    expect(result.shown).toEqual([]);
    expect(result.message).toMatch(/Only published tools/);
    expect(write).not.toHaveBeenCalled();
  });

  it("writes nothing when the only tool asked for is the one on screen", async () => {
    const { ctx, write } = writerCtx({ focusedToolId: await toolIdOf("form-4") });
    const result = await showTool.run({ tools: ["Form 4"] }, ctx);
    expect(result.message).toMatch(/page already shows it/);
    expect(write).not.toHaveBeenCalled();
  });

  it("shows each tool once, and draws one row per reply", async () => {
    const { ctx, write } = writerCtx();
    const first = await showTool.run({ tools: ["form-4", "Form 4"] }, ctx);
    expect(first.shown).toHaveLength(1);
    const second = await showTool.run({ tools: ["trotec-speedy-400"] }, ctx);
    expect(second.shown).toEqual([]);
    expect(second.message).toMatch(/already shown/);
    expect(write).toHaveBeenCalledOnce();
  });

  it("refuses more than three tools at the schema", () => {
    expect(showTool.inputSchema.safeParse({ tools: ["a", "b", "c", "d"] }).success).toBe(false);
    expect(showTool.inputSchema.safeParse({ tools: [] }).success).toBe(false);
  });

  it("is offered to anonymous visitors in the chat, and never over MCP", () => {
    const chatTools = toAiTools(capabilitiesForIdentity(CAPABILITIES, { role: "anonymous" }), {});
    expect(Object.keys(chatTools)).toContain("show_tool");
    const mcp = mcpToolsFor(CAPABILITIES, { identity: { role: "super_admin" } as never, readOnly: false });
    expect(mcp.map(({ tool }) => tool.name)).toContain("get_tool_details");
    expect(mcp.map(({ tool }) => tool.name)).not.toContain("show_tool");
    expect(toolCards.promptFragment({ tools: [] })).toMatch(/Do not call it for list answers/);
  });
});
