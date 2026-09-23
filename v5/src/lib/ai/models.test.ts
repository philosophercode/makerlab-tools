// @vitest-environment node
import {
  GATEWAY_MODEL_ID_PATTERN,
  MODEL_JOBS,
  ModelConfigError,
  gatewayLanguageModel,
  gatewayProvider,
  languageModelFor,
  modelIdFor,
  type ModelJob,
} from "./models";

/**
 * The job registry (gateway spec §3.1, §10 "Unit"): defaults, overrides, a
 * malformed override naming its variable and never its value, an unknown job,
 * and a model that can be built without the network.
 *
 * Every override is stubbed explicitly — including to "" — because
 * `vi.unstubAllEnvs()` runs after each test and a developer's shell may have
 * any of these set.
 */

const JOBS = Object.keys(MODEL_JOBS) as ModelJob[];

function clearOverrides() {
  for (const job of JOBS) vi.stubEnv(MODEL_JOBS[job].env, "");
  vi.stubEnv("AI_GATEWAY_BASE_URL", "");
}

beforeEach(clearOverrides);

describe("MODEL_JOBS", () => {
  it("defaults chat to Sonnet 5 (Luna missed the eval gate) and every other job to Luna — there is no image job", () => {
    expect(modelIdFor("chat")).toBe("anthropic/claude-sonnet-5");
    expect(modelIdFor("researchSearch")).toBe("openai/gpt-6-luna");
    expect(modelIdFor("researchRead")).toBe("openai/gpt-6-luna");
    expect(modelIdFor("imageRank")).toBe("openai/gpt-6-luna");
    // The generative background redraw was retired (amendment "No generative redraw").
    expect(Object.keys(MODEL_JOBS)).not.toContain("imageClean");
  });

  it("names one MODEL_<JOB> variable per job, and every default is a Gateway id", () => {
    expect(JOBS.map((job) => MODEL_JOBS[job].env)).toEqual([
      "MODEL_CHAT",
      "MODEL_RESEARCH_SEARCH",
      "MODEL_RESEARCH_READ",
      "MODEL_IMAGE_RANK",
    ]);
    for (const job of JOBS) expect(MODEL_JOBS[job].default).toMatch(GATEWAY_MODEL_ID_PATTERN);
  });
});

describe("modelIdFor", () => {
  it.each(JOBS)("honours the override for %s, and only for that job", (job) => {
    vi.stubEnv(MODEL_JOBS[job].env, "openai/gpt-6-sol");

    expect(modelIdFor(job)).toBe("openai/gpt-6-sol");
    for (const other of JOBS.filter((j) => j !== job)) {
      expect(modelIdFor(other)).toBe(MODEL_JOBS[other].default);
    }
  });

  it("reads the override at call time, not at import", () => {
    expect(modelIdFor("chat")).toBe("anthropic/claude-sonnet-5");
    vi.stubEnv("MODEL_CHAT", "openai/gpt-6-luna");
    expect(modelIdFor("chat")).toBe("openai/gpt-6-luna");
  });

  it("treats a blank or whitespace-only override as unset", () => {
    vi.stubEnv("MODEL_RESEARCH_READ", "   ");
    expect(modelIdFor("researchRead")).toBe("openai/gpt-6-luna");
  });

  it("trims a padded override", () => {
    vi.stubEnv("MODEL_IMAGE_RANK", "  google/gemini-3-flash \n");
    expect(modelIdFor("imageRank")).toBe("google/gemini-3-flash");
  });

  it.each(["gpt-6", "openai/GPT 6", "openai/", "/gpt-6", "openai/gpt-6/extra", "sk-live-abc123secret"])(
    "refuses the malformed override %j, naming the variable and never the value",
    (value) => {
      vi.stubEnv("MODEL_RESEARCH_READ", value);

      let thrown: unknown;
      try {
        modelIdFor("researchRead");
      } catch (error) {
        thrown = error;
      }
      expect(ModelConfigError.isInstance(thrown)).toBe(true);
      const error = thrown as ModelConfigError;
      expect(error.name).toBe("ModelConfigError");
      expect(error.envVar).toBe("MODEL_RESEARCH_READ");
      expect(error.job).toBe("researchRead");
      expect(error.message).toContain("MODEL_RESEARCH_READ");
      expect(error.message).not.toContain(value);
    }
  );

  it("refuses an unknown job with no variable to blame", () => {
    let thrown: unknown;
    try {
      modelIdFor("summarize" as ModelJob);
    } catch (error) {
      thrown = error;
    }
    expect(ModelConfigError.isInstance(thrown)).toBe(true);
    expect((thrown as ModelConfigError).envVar).toBeNull();
    expect((thrown as ModelConfigError).job).toBe("summarize");
  });

  it("does not treat an inherited property as a job", () => {
    expect(() => modelIdFor("toString" as ModelJob)).toThrow(ModelConfigError);
  });
});

describe("the model factories", () => {
  it("builds Gateway models for each job, with the resolved id", () => {
    vi.stubEnv("MODEL_CHAT", "anthropic/claude-sonnet-5");

    expect(languageModelFor("chat")).toMatchObject({
      provider: "gateway",
      modelId: "anthropic/claude-sonnet-5",
      specificationVersion: "v3",
    });
    expect(languageModelFor("researchSearch")).toMatchObject({ modelId: "openai/gpt-6-luna" });
  });

  it("refuses the retired image job", () => {
    expect(() => languageModelFor("imageClean" as never)).toThrow(ModelConfigError);
  });

  it("surfaces a malformed override when the model is built", () => {
    vi.stubEnv("MODEL_IMAGE_RANK", "gpt-6-luna");
    expect(() => languageModelFor("imageRank")).toThrow(/MODEL_IMAGE_RANK/);
  });

  it("makes no network call when a model is constructed", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    languageModelFor("chat");
    languageModelFor("imageRank");
    gatewayLanguageModel("openai/gpt-6-sol", "EVAL_MODEL");

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("gatewayLanguageModel", () => {
  it("builds a validated model by explicit id", () => {
    expect(gatewayLanguageModel("openai/gpt-6-sol", "EVAL_MODEL")).toMatchObject({
      provider: "gateway",
      modelId: "openai/gpt-6-sol",
    });
  });

  it("names the variable it came from, never the value", () => {
    let thrown: unknown;
    try {
      gatewayLanguageModel("claude-sonnet-4-6", "EVAL_MODEL");
    } catch (error) {
      thrown = error;
    }
    expect(ModelConfigError.isInstance(thrown)).toBe(true);
    expect((thrown as ModelConfigError).envVar).toBe("EVAL_MODEL");
    expect((thrown as Error).message).toContain("EVAL_MODEL");
    expect((thrown as Error).message).not.toContain("claude-sonnet-4-6");
  });
});

describe("gatewayProvider", () => {
  it("is memoised per base URL", () => {
    const first = gatewayProvider();
    expect(gatewayProvider()).toBe(first);

    vi.stubEnv("AI_GATEWAY_BASE_URL", "http://localhost:3103/v3/ai");
    const stubbed = gatewayProvider();
    expect(stubbed).not.toBe(first);
    expect(gatewayProvider()).toBe(stubbed);
  });

  it("honours AI_GATEWAY_BASE_URL on the wire", async () => {
    vi.stubEnv("AI_GATEWAY_BASE_URL", "http://gateway.test/v3/ai");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    const seen: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      seen.push(String(input instanceof Request ? input.url : input));
      return Response.json({ error: { message: "nope", type: "model_not_found" } }, { status: 404 });
    });

    await expect(
      languageModelFor("chat").doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }] })
    ).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["http://gateway.test/v3/ai/language-model"]);
  });

  it("refuses a base URL that is not http(s), naming the variable", () => {
    vi.stubEnv("AI_GATEWAY_BASE_URL", "file:///etc/passwd");
    expect(() => gatewayProvider()).toThrow(/AI_GATEWAY_BASE_URL/);
  });
});
