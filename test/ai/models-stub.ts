import { MockImageModelV3, MockLanguageModelV3, MockRerankingModelV3 } from "ai/test";
import type * as ModelsModule from "../../src/lib/ai/models";

/**
 * Models stubbed at the AI SDK boundary (gateway spec §10: "Unit and
 * integration tests stub at the AI SDK boundary with `MockLanguageModelV3`…
 * Nothing in a test knows the provider"). The one image job, `illustration`
 * (chat illustrations; the product-photo redraw stays retired), is stubbed with
 * `setImageModel(imageModel(…))`.
 *
 * The registry (`src/lib/ai/models.ts`) is the one place a job becomes a
 * model, so it is the one place a test swaps one in:
 *
 * ```ts
 * vi.mock("@/lib/ai/models", async (importOriginal) =>
 *   (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
 * );
 *
 * beforeEach(() => setLanguageModel("chat", textModel("Hello.")));
 * afterEach(resetModelStubs);
 * ```
 *
 * The mocked id covers every importer, including the relative
 * `"../ai/models.ts"` that step code uses. Everything else in the module stays
 * real — `modelIdFor`, `MODEL_JOBS`, the Exa tools' `gatewayProvider()` — so a
 * `MODEL_*` misconfiguration still throws where it would. A job nobody stubbed
 * throws "no model stubbed for <job>" instead of reaching the network.
 *
 * (Workflow-tier tests cannot use this — `vi.mock` does not reach the step
 * bundle — and stub the Gateway's HTTP endpoint with `test/gateway/msw.ts`.)
 */

type Models = typeof ModelsModule;
type LanguageJob = ModelsModule.LanguageJob;
type LanguageModel = ReturnType<Models["languageModelFor"]>;
type GenerateResult = Awaited<ReturnType<LanguageModel["doGenerate"]>>;
type CallOptions = Parameters<LanguageModel["doGenerate"]>[0];
type StreamPart = Awaited<ReturnType<LanguageModel["doStream"]>>["stream"] extends ReadableStream<infer P> ? P : never;

const languageModels = new Map<LanguageJob, LanguageModel>();
let embeddingModel: ReturnType<Models["embeddingModelFor"]> | null = null;
type RerankingModel = ReturnType<Models["rerankingModelFor"]>;
let stubbedReranker: RerankingModel | null = null;
type ImageModel = ReturnType<Models["imageModelFor"]>;
let stubbedImageModel: ImageModel | null = null;

/** The module factory for `vi.mock("@/lib/ai/models", …)`: the real module with the model factory swapped. */
export function stubModelsModule(actual: Models): Models {
  return {
    ...actual,
    languageModelFor: (job: LanguageJob) => {
      // Still resolve the id, so an invalid override fails the way it would in production.
      actual.modelIdFor(job);
      const model = languageModels.get(job);
      if (!model) throw new Error(`no model stubbed for ${job} — call setLanguageModel("${job}", …)`);
      return model;
    },
    // Manual search (job `embed`): a fake with fixed vectors — `test/ai/fake-embeddings.ts`.
    embeddingModelFor: (job = "embed") => {
      actual.modelIdFor(job);
      if (!embeddingModel) throw new Error(`no embedding model stubbed — call setEmbeddingModel(…)`);
      return embeddingModel;
    },
    // Manual search reranking (job `rerank`): the order it was given unless a
    // test sets one — `setRerankingModel(rerankingModel(…))`.
    rerankingModelFor: (job = "rerank") => {
      actual.modelIdFor(job);
      return stubbedReranker ?? keepOrderReranker();
    },
    // Chat illustrations (job `illustration`): nothing unless a test sets one.
    imageModelFor: (job = "illustration") => {
      actual.modelIdFor(job);
      if (!stubbedImageModel) throw new Error(`no image model stubbed — call setImageModel(…)`);
      return stubbedImageModel;
    },
  };
}

export function setLanguageModel(job: LanguageJob, model: LanguageModel): void {
  languageModels.set(job, model);
}

/** The model job `embed` resolves to, e.g. `fakeEmbeddingTarget().model`. */
export function setEmbeddingModel(model: ReturnType<Models["embeddingModelFor"]>): void {
  embeddingModel = model;
}

/** The model job `rerank` resolves to. */
export function setRerankingModel(model: RerankingModel): void {
  stubbedReranker = model;
}

/** The model job `illustration` resolves to, e.g. `imageModel([pngBytes])`. */
export function setImageModel(model: ImageModel): void {
  stubbedImageModel = model;
}

export function resetModelStubs(): void {
  languageModels.clear();
  embeddingModel = null;
  stubbedReranker = null;
  stubbedImageModel = null;
}

/**
 * An image model that answers every call with `images` (their bytes) and
 * the Gateway's `providerMetadata` (its reported cost, when given) — or
 * throws `error`. Calls are on `.doGenerateCalls` (prompt, size, n).
 */
export function imageModel(
  images: readonly Uint8Array[],
  options: { cost?: string | number; error?: Error } = {}
): MockImageModelV3 & { doGenerateCalls: { prompt: string | undefined; size: string | undefined; n: number }[] } {
  const calls: { prompt: string | undefined; size: string | undefined; n: number }[] = [];
  const model = new MockImageModelV3({
    provider: "gateway",
    modelId: "stub/image",
    doGenerate: async (call) => {
      calls.push({ prompt: call.prompt, size: call.size, n: call.n });
      if (options.error) throw options.error;
      return {
        images: [...images],
        warnings: [],
        response: { timestamp: new Date(), modelId: "stub/image", headers: undefined },
        providerMetadata: {
          ...(options.cost !== undefined ? { gateway: { images: [], cost: String(options.cost) } } : {}),
        },
      };
    },
  });
  return Object.assign(model, { doGenerateCalls: calls });
}

/**
 * A reranker that scores each document with `score(document, query)` and
 * orders them by it (ties keep their order). Calls are on `.doRerankCalls`.
 */
export function rerankingModel(
  score: (document: string, query: string) => number
): MockRerankingModelV3 & { doRerankCalls: { query: string; documents: string[] }[] } {
  const calls: { query: string; documents: string[] }[] = [];
  const model = new MockRerankingModelV3({
    provider: "gateway",
    modelId: "stub/reranker",
    doRerank: async (options) => {
      const documents = options.documents.type === "text" ? options.documents.values : options.documents.values.map((v) => JSON.stringify(v));
      calls.push({ query: options.query, documents });
      const ranking = documents
        .map((document, index) => ({ index, relevanceScore: score(document, options.query) }))
        .sort((a, b) => b.relevanceScore - a.relevanceScore || a.index - b.index);
      return { ranking };
    },
  });
  return Object.assign(model, { doRerankCalls: calls });
}

/** The default: every document scored by its position, so the order given stands. */
function keepOrderReranker(): MockRerankingModelV3 {
  return new MockRerankingModelV3({
    provider: "gateway",
    modelId: "stub/reranker",
    doRerank: async (options) => ({
      ranking: options.documents.values.map((_, index) => ({ index, relevanceScore: 1 - index / 1000 })),
    }),
  });
}

// ── Model builders ────────────────────────────────────────────────────

const USAGE: GenerateResult["usage"] = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

export interface RecordedCall {
  /** Which entry point the SDK used. */
  mode: "generate" | "stream";
  prompt: CallOptions["prompt"];
  tools: CallOptions["tools"];
  providerOptions: CallOptions["providerOptions"];
  /** The whole call, for anything else (toolChoice, abortSignal, …). */
  options: CallOptions;
}

const calls = new WeakMap<object, RecordedCall[]>();

/** Every call a model received, in order — across `generateText` and `streamText`. */
export function recordedCalls(model: LanguageModel): RecordedCall[] {
  const recorded = calls.get(model);
  if (recorded) return recorded;
  // A MockLanguageModelV3 built elsewhere: its own lists, generate calls first.
  const mock = model as unknown as Partial<Pick<MockLanguageModelV3, "doGenerateCalls" | "doStreamCalls">>;
  const toRecord = (mode: RecordedCall["mode"]) => (options: CallOptions): RecordedCall => ({
    mode,
    prompt: options.prompt,
    tools: options.tools,
    providerOptions: options.providerOptions,
    options,
  });
  return [...(mock.doGenerateCalls ?? []).map(toRecord("generate")), ...(mock.doStreamCalls ?? []).map(toRecord("stream"))];
}

type Turn = { content: GenerateResult["content"]; finishReason: GenerateResult["finishReason"]["unified"] };

/**
 * A model that answers call `n` (0-based, counted across both entry points)
 * with `turns(n)`, through `generateText` or `streamText` alike. Calls are
 * recorded for {@link recordedCalls}. Like the Gateway, it accepts URLs in file
 * parts, so the SDK never downloads anything on its behalf.
 */
export function scriptedModel(turns: (callIndex: number) => Turn): MockLanguageModelV3 {
  const record: RecordedCall[] = [];
  const log = (mode: RecordedCall["mode"], options: CallOptions) => {
    record.push({ mode, prompt: options.prompt, tools: options.tools, providerOptions: options.providerOptions, options });
    return record.length - 1;
  };

  const model = new MockLanguageModelV3({
    provider: "gateway",
    modelId: "stub/model",
    supportedUrls: { "*/*": [/.*/] },
    doGenerate: async (options) => {
      const turn = turns(log("generate", options));
      return {
        content: turn.content,
        finishReason: { unified: turn.finishReason, raw: turn.finishReason },
        usage: USAGE,
        warnings: [],
      };
    },
    doStream: async (options) => {
      const turn = turns(log("stream", options));
      return { stream: toStream(turn) };
    },
  });
  calls.set(model, record);
  return model;
}

/** A model that answers with text — the same text every call, or `text(callIndex)`. */
export function textModel(text: string | ((callIndex: number) => string)): MockLanguageModelV3 {
  return scriptedModel((i) => ({
    content: [{ type: "text", text: typeof text === "function" ? text(i) : text }],
    finishReason: "stop",
  }));
}

/** A text model meant for `streamText`; identical to {@link textModel}, which streams too. */
export function streamingTextModel(text: string): MockLanguageModelV3 {
  return textModel(text);
}

export interface StubToolCall {
  toolName: string;
  input: unknown;
  toolCallId?: string;
}

/**
 * A model that calls `toolCalls` on its first turn and then answers `finalText` —
 * the shape of one tool round trip. The SDK runs the tools (they are ours) and
 * calls the model again, provided the caller allows a second step.
 */
export function toolCallModel(toolCalls: readonly StubToolCall[], finalText = ""): MockLanguageModelV3 {
  return scriptedModel((i) =>
    i === 0
      ? {
          content: toolCalls.map((call, n) => ({
            type: "tool-call" as const,
            toolCallId: call.toolCallId ?? `call_${n + 1}`,
            toolName: call.toolName,
            input: JSON.stringify(call.input),
          })),
          finishReason: "tool-calls",
        }
      : { content: [{ type: "text", text: finalText }], finishReason: "stop" }
  );
}

function toStream(turn: Turn): ReadableStream<StreamPart> {
  const parts: StreamPart[] = [{ type: "stream-start", warnings: [] }];
  for (const [n, item] of turn.content.entries()) {
    if (item.type === "text") {
      const id = `txt_${n}`;
      parts.push({ type: "text-start", id }, { type: "text-delta", id, delta: item.text }, { type: "text-end", id });
    } else {
      parts.push(item as StreamPart);
    }
  }
  parts.push({ type: "finish", finishReason: { unified: turn.finishReason, raw: turn.finishReason }, usage: USAGE });
  return new ReadableStream<StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}
