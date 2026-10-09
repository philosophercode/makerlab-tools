// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

// The Blob seam: a store that keeps what it is given.
const blob = vi.hoisted(() => ({ configured: true, putUpload: vi.fn() }));
vi.mock("@/lib/blob", () => ({
  isBlobConfigured: () => blob.configured,
  getBlobStore: () => ({ putUpload: blob.putUpload }),
}));

import { imageModel, resetModelStubs, setImageModel } from "../../../test/ai/models-stub";
import { makePng } from "../../../test/gateway/png";
import { seedUser } from "../../../test/utils/session";
import { resetDbForTests } from "../db/client";
import type { Identity } from "../auth/identity";
import { capabilitiesForIdentity } from "./access";
import { buildSystemPrompt, toAiTools } from "./chat-adapter";
import { illustrations, illustrationsAvailable, makeIllustrationTool } from "./illustrations";
import { CAPABILITIES } from "./index";
import { mcpToolsFor } from "./mcp-access";
import type { CapabilityCtx } from "./types";

/**
 * `make_illustration` (gateway spec amendment 2026-10-07; assistant–GUI parity
 * spec amendment "Images in the chat"): offered to signed-in people only, the
 * locked note telling the assistant to point a visitor to sign-in; the offer
 * comes before the picture; one per reply; the `data-illustration` part built
 * by the server; each refusal worded for the assistant; never over MCP.
 */

const PNG = makePng({ width: 32, height: 32, alpha: false });

function identity(role: Identity["role"], userId: string | null): Identity {
  return { role, userId, email: null, name: null, rateLimitKey: userId ?? "ip" };
}

function writerCtx(extra: Partial<CapabilityCtx> = {}) {
  const write = vi.fn();
  const ctx = { writer: { write, merge: vi.fn(), onError: undefined }, ...extra } as unknown as CapabilityCtx;
  return { ctx, write };
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("MODEL_ILLUSTRATION", "");
  blob.configured = true;
  blob.putUpload.mockReset().mockImplementation(async (prefix: string) => ({ pathname: `${prefix}x.png`, url: "https://blob.example/x" }));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetModelStubs();
  resetDbForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who is offered illustrations", () => {
  it("gives every signed-in role the tool, and an anonymous visitor only the sign-in note", () => {
    for (const role of ["user", "admin", "super_admin"] as const) {
      const tools = toAiTools(capabilitiesForIdentity(CAPABILITIES, { role }), {});
      expect(Object.keys(tools)).toContain("make_illustration");
    }
    const anonymous = capabilitiesForIdentity(CAPABILITIES, { role: "anonymous" });
    expect(Object.keys(toAiTools(anonymous, {}))).not.toContain("make_illustration");
    const prompt = buildSystemPrompt(anonymous, { tools: [] });
    expect(prompt).toMatch(/This person is not signed in: if they ask for a sketch/);
    expect(prompt).toMatch(/Sign in button/);
  });

  it("tells a signed-in person's assistant to offer first and never to depict the lab's machines", () => {
    const fragment = illustrations.promptFragment({ tools: [] });
    expect(fragment).toMatch(/Offer it; do not make it unasked/);
    expect(fragment).toMatch(/Want a sketch of this plan\?/);
    expect(fragment).toMatch(/Never use it to show how one of the lab's machines looks, its controls, its labels or its safety steps/);
    expect(fragment).toContain("AI-generated illustration, not a photo of our equipment. Check the manual and staff for exact steps.");
  });

  it("is never registered over MCP", () => {
    const mcp = mcpToolsFor(CAPABILITIES, { identity: identity("super_admin", "u1") as never, readOnly: false });
    expect(mcp.map(({ tool }) => tool.name)).not.toContain("make_illustration");
  });

  it("is available only when switched on and there is somewhere to keep it", () => {
    expect(illustrationsAvailable()).toBe(true);
    vi.stubEnv("MODEL_ILLUSTRATION", "off");
    expect(illustrationsAvailable()).toBe(false);
    vi.stubEnv("MODEL_ILLUSTRATION", "");
    blob.configured = false;
    expect(illustrationsAvailable()).toBe(false);
  });
});

describe("make_illustration", () => {
  it("draws the picture and writes the labelled card's payload, built by the server", async () => {
    setImageModel(imageModel([PNG], { cost: "0.007" }));
    const person = await seedUser({ role: "user" });
    const { ctx, write } = writerCtx({ identity: identity("user", person.id) });

    const result = await makeIllustrationTool.run({ kind: "plan", description: "1. Cut\n2. Sand\n3. Glue" }, ctx);

    expect(result).toMatchObject({ made: true });
    expect((result as { message: string }).message).toMatch(/Never call it a photo/);
    expect(write).toHaveBeenCalledOnce();
    const part = write.mock.calls[0][0];
    expect(part.type).toBe("data-illustration");
    expect(part.data).toEqual({
      kind: "illustration",
      id: expect.any(String),
      url: `/api/chat/illustrations/${part.data.id}`,
      width: 32,
      height: 32,
      subject: "plan",
    });
  });

  it("draws once per reply", async () => {
    const model = imageModel([PNG]);
    setImageModel(model);
    const person = await seedUser({ role: "user" });
    const { ctx } = writerCtx({ identity: identity("user", person.id) });
    await makeIllustrationTool.run({ kind: "concept", description: "A lamp" }, ctx);
    const again = await makeIllustrationTool.run({ kind: "concept", description: "A lamp" }, ctx);
    expect(again).toMatchObject({ made: false, reason: "once_per_reply" });
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("words each refusal for the assistant and writes no card", async () => {
    setImageModel(imageModel([PNG]));
    const person = await seedUser({ role: "user" });

    vi.stubEnv("MODEL_ILLUSTRATION", "off");
    const off = writerCtx({ identity: identity("user", person.id) });
    expect(await makeIllustrationTool.run({ kind: "concept", description: "A lamp" }, off.ctx)).toMatchObject({
      made: false,
      reason: "off",
      message: expect.stringMatching(/switched off/),
    });
    vi.stubEnv("MODEL_ILLUSTRATION", "");

    const nothing = writerCtx({ identity: identity("user", person.id) });
    expect(await makeIllustrationTool.run({ kind: "plan", description: "Push the red button." }, nothing.ctx)).toMatchObject({
      made: false,
      reason: "nothing_to_draw",
    });

    expect(off.write).not.toHaveBeenCalled();
    expect(nothing.write).not.toHaveBeenCalled();
  });

  it("refuses at the schema a kind other than a plan or a concept", () => {
    expect(makeIllustrationTool.inputSchema.safeParse({ kind: "photo", description: "The Form 4" }).success).toBe(false);
    expect(makeIllustrationTool.inputSchema.safeParse({ kind: "plan", description: "" }).success).toBe(false);
  });
});
