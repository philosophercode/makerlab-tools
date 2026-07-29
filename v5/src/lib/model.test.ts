import {
  CHAT_MODEL_ID,
  GATEWAY_CHAT_MODEL_ID,
  resolveChatModel,
  usesGateway,
} from "@/lib/model";

// The whole logical surface of model.ts is "which provider path does the env
// select". `vi.unstubAllEnvs()` runs after every test (vitest.setup.ts), so each
// case stubs `AI_GATEWAY_API_KEY` explicitly — including to `undefined` — rather
// than inheriting whatever the developer's shell happens to have set.

describe("resolveChatModel", () => {
  it("routes through the gateway when AI_GATEWAY_API_KEY is set", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "vck_test");

    expect(usesGateway()).toBe(true);
    // The explicit `@ai-sdk/gateway` provider, not the direct Anthropic client.
    // Constructing it is pure — no request is made, which is what keeps this
    // test offline (constitution Article 3).
    expect(resolveChatModel()).toMatchObject({
      modelId: GATEWAY_CHAT_MODEL_ID,
      provider: "gateway",
    });
  });

  it("uses the direct Anthropic provider when AI_GATEWAY_API_KEY is absent", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", undefined);

    expect(usesGateway()).toBe(false);

    const model = resolveChatModel();
    expect(typeof model).not.toBe("string");
    expect(model).toMatchObject({
      modelId: CHAT_MODEL_ID,
      provider: expect.stringContaining("anthropic"),
    });
  });

  it("treats an empty AI_GATEWAY_API_KEY as unconfigured", () => {
    // A var declared-but-blank in a dashboard is the common misconfiguration;
    // it must fall back to the working direct path, not select a keyless gateway.
    vi.stubEnv("AI_GATEWAY_API_KEY", "");

    expect(usesGateway()).toBe(false);
    expect(resolveChatModel()).toMatchObject({ modelId: CHAT_MODEL_ID });
  });
});

describe("chatModel", () => {
  // `chatModel` is resolved once at module load, so the env has to be stubbed
  // before the module is (re-)imported — the documented pattern in test/README.
  async function importChatModel(gatewayKey: string | undefined) {
    vi.stubEnv("AI_GATEWAY_API_KEY", gatewayKey);
    vi.resetModules();
    return (await import("@/lib/model")).chatModel;
  }

  it("exports the gateway model when the gateway key is present at load", async () => {
    await expect(importChatModel("vck_test")).resolves.toMatchObject({
      modelId: GATEWAY_CHAT_MODEL_ID,
      provider: "gateway",
    });
  });

  it("exports the direct model when no gateway key is present at load", async () => {
    await expect(importChatModel(undefined)).resolves.toMatchObject({
      modelId: CHAT_MODEL_ID,
      provider: expect.stringContaining("anthropic"),
    });
  });

  it("names the gateway model with the gateway's own provider-namespaced id", async () => {
    // Guards the pair of ids against being "helpfully" unified: Anthropic's own
    // API spells the version with dashes, the gateway with dots, and neither
    // string works in the other place.
    expect(GATEWAY_CHAT_MODEL_ID).toBe("anthropic/claude-sonnet-4.6");
    expect(GATEWAY_CHAT_MODEL_ID).not.toBe(CHAT_MODEL_ID);
  });

  it("keeps the direct model id the chat route used before centralization", () => {
    // Guards the pure-refactor claim: this is the exact string that was inlined
    // in src/app/api/chat/route.ts. Changing it changes the production model.
    expect(CHAT_MODEL_ID).toBe("claude-sonnet-4-6");
  });
});
