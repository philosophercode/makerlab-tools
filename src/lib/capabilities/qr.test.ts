// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { getDb, resetDbForTests } from "../db/client";
import { tools } from "../db/schema/index";
import { newTurnState } from "../chat/taint";
import { capabilitiesForIdentity } from "./access";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";
import { getToolQrCode, qr } from "./qr";
import type { CapabilityCtx } from "./types";
import { toAiTools } from "./chat-adapter";

vi.mock("next/cache", () => nextCacheMock());

/**
 * `get_tool_qr_code` (QR labels) against the demo seed: a published tool by
 * name, slug or the page the person is on; drafts are not found, for staff
 * too; the chat card is written with server-built URLs; it is offered to
 * every role, anonymous included, and never taints a turn.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://tools.example.edu");
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

describe("get_tool_qr_code", () => {
  it("answers a published tool by name with its scan address, and draws the card", async () => {
    const { ctx, write } = writerCtx();
    const result = await getToolQrCode.run({ tool: "Trotec" }, ctx);
    expect(result).toEqual({
      found: true,
      name: "Trotec Speedy 400",
      slug: "trotec-speedy-400",
      scan_url: "https://tools.example.edu/tools/trotec-speedy-400?src=qr",
      page: "/tools/trotec-speedy-400",
      png_download: "/api/qr/trotec-speedy-400?format=png&download=1",
      svg_download: "/api/qr/trotec-speedy-400?format=svg&download=1",
    });
    expect(write).toHaveBeenCalledWith({
      type: "data-tool-qr",
      id: "qr-trotec-speedy-400",
      data: {
        kind: "tool-qr",
        name: "Trotec Speedy 400",
        slug: "trotec-speedy-400",
        scanUrl: "https://tools.example.edu/tools/trotec-speedy-400?src=qr",
        shortUrl: "tools.example.edu/tools/trotec-speedy-400",
        imageUrl: "/api/qr/trotec-speedy-400?format=svg",
        pngUrl: "/api/qr/trotec-speedy-400?format=png&download=1",
        svgUrl: "/api/qr/trotec-speedy-400?format=svg&download=1",
      },
    });
  });

  it("uses the tool the person is looking at when none is named", async () => {
    const db = await getDb();
    const [form] = await db.select({ id: tools.id }).from(tools).where((await import("drizzle-orm")).eq(tools.slug, "form-4"));
    const result = await getToolQrCode.run({}, { focusedToolId: form.id });
    expect(result).toMatchObject({ found: true, slug: "form-4" });
  });

  it("finds no draft — there is no public page for its code to open", async () => {
    const db = await getDb();
    await db.insert(tools).values({ slug: "draft-bandsaw", name: "Draft Bandsaw", published: false });
    const { ctx, write } = writerCtx();
    const result = await getToolQrCode.run({ tool: "draft-bandsaw" }, ctx);
    expect(result).toMatchObject({ found: false });
    expect(write).not.toHaveBeenCalled();
  });

  it("asks which tool when there is neither a name nor a page", async () => {
    expect(await getToolQrCode.run({}, {})).toMatchObject({ found: false });
  });
});

describe("who gets it", () => {
  it.each(["anonymous", "user", "admin", "super_admin"] as const)("is offered to %s in the chat", (role) => {
    const names = capabilitiesForIdentity(CAPABILITIES, { role }).flatMap((capability) => capability.tools.map((tool) => tool.name));
    expect(names).toContain("get_tool_qr_code");
  });

  it("is a read, chat only, with no permission of its own", () => {
    expect(getToolQrCode).toMatchObject({ kind: "read", chatOnly: true });
    expect(getToolQrCode.requiredPermission).toBeUndefined();
    expect(qr.requiredPermission).toBeUndefined();
    const mcp = mcpToolsFor(CAPABILITIES, { identity: { role: "super_admin" } as never, readOnly: false });
    expect(mcp.map(({ tool }) => tool.name)).not.toContain("get_tool_qr_code");
  });

  it("does not taint the turn (it returns only the lab's own catalogue data)", async () => {
    const turn = newTurnState();
    const aiTools = toAiTools([qr], { turn });
    await (aiTools.get_tool_qr_code as unknown as { execute: (input: unknown, options: unknown) => Promise<unknown> }).execute({ tool: "form-4" }, {});
    expect(turn.readOutside).toBe(false);
  });
});
