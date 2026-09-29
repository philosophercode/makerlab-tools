// @vitest-environment node
import { canonicalInputs, normalizeQuestion, starterSourceHash, STARTER_ANSWER_VERSION, type ToolHashInputs } from "./hash";

const manual = {
  id: "m-1",
  status: "ready",
  extractorVersion: "x-3",
  chunkerVersion: "c-2",
  embeddingModel: "openai/text-embedding-3-small@512",
  ocrVersion: null,
  updatedAt: "1790000000.123",
};

const tool: ToolHashInputs = {
  kind: "tool",
  toolId: "t-1",
  revision: "1790000000.5",
  resources: [
    { id: "r-2", updatedAt: "1790000001", published: true },
    { id: "r-1", updatedAt: "1790000002", published: false },
  ],
  manuals: [manual, { ...manual, id: "m-0" }],
};

const context = { question: "How do I start my first print?", locale: "en", model: "openai/gpt-6-luna", promptKey: "makerlab-chat-v1" };

describe("starterSourceHash", () => {
  it("is a sha256 digest, the same for the same inputs whatever their order", () => {
    const hash = starterSourceHash(tool, context);
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const reordered: ToolHashInputs = { ...tool, resources: [...tool.resources].reverse(), manuals: [...tool.manuals].reverse() };
    expect(starterSourceHash(reordered, context)).toBe(hash);
  });

  it("changes with everything an answer rests on", () => {
    const base = starterSourceHash(tool, context);
    const variants: [string, string][] = [
      ["tool revision", starterSourceHash({ ...tool, revision: "1790000009" }, context)],
      ["a resource edited", starterSourceHash({ ...tool, resources: [{ ...tool.resources[0], updatedAt: "9" }, tool.resources[1]] }, context)],
      ["a resource hidden", starterSourceHash({ ...tool, resources: [{ ...tool.resources[0], published: false }, tool.resources[1]] }, context)],
      ["a resource added", starterSourceHash({ ...tool, resources: [...tool.resources, { id: "r-3", updatedAt: "1", published: true }] }, context)],
      ["a manual re-chunked", starterSourceHash({ ...tool, manuals: [{ ...manual, chunkerVersion: "c-3" }, tool.manuals[1]] }, context)],
      ["a manual re-embedded", starterSourceHash({ ...tool, manuals: [{ ...manual, embeddingModel: "voyage/voyage-4-lite@512" }, tool.manuals[1]] }, context)],
      ["a manual failed", starterSourceHash({ ...tool, manuals: [{ ...manual, status: "failed" }, tool.manuals[1]] }, context)],
      ["the chat model", starterSourceHash(tool, { ...context, model: "openai/gpt-6-sol" })],
      ["the prompt version", starterSourceHash(tool, { ...context, promptKey: "makerlab-chat-v2" })],
      ["the locale", starterSourceHash(tool, { ...context, locale: "fr" })],
      ["the question", starterSourceHash(tool, { ...context, question: "Can I print resin?" })],
    ];
    for (const [what, hash] of variants) expect(hash, what).not.toBe(base);
  });

  it("ignores spacing in the question, not its case", () => {
    const base = starterSourceHash(tool, context);
    expect(starterSourceHash(tool, { ...context, question: "  How do I start  my first print? " })).toBe(base);
    expect(starterSourceHash(tool, { ...context, question: "how do I start my first print?" })).not.toBe(base);
    expect(normalizeQuestion(" a \n b ")).toBe("a b");
  });

  it("keys the general chips on the published catalogue's names and every manual, never on units", () => {
    const general = { kind: "general" as const, tools: [{ id: "t-1", name: "Form 4" }], manuals: [manual] };
    const base = starterSourceHash(general, context);
    expect(starterSourceHash({ ...general, tools: [{ id: "t-1", name: "Formlabs Form 4" }] }, context)).not.toBe(base);
    expect(starterSourceHash({ ...general, tools: [...general.tools, { id: "t-2", name: "Trotec" }] }, context)).not.toBe(base);
    expect(starterSourceHash({ ...general, manuals: [] }, context)).not.toBe(base);
    expect(starterSourceHash(general, context)).not.toBe(starterSourceHash(tool, context));
  });

  it("carries the pipeline version", () => {
    expect(canonicalInputs(tool, context)).toContain(STARTER_ANSWER_VERSION);
  });
});
