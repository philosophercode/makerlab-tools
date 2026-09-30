/**
 * The Vercel AI Gateway's wire format, as `@ai-sdk/gateway` speaks it — parsers
 * for what the provider sends and builders for what the Gateway answers
 * (gateway spec §10: "Both use the Gateway wire format captured as fixtures in
 * Phase 0"). The recorded exchanges are in `test/gateway/fixtures/`; every
 * shape here matches them, and `src/lib/ai/gateway-wire.test.ts` proves the
 * builders round-trip through the real provider.
 *
 * Two consumers, so **no dependencies**: nothing but relative `.ts` imports and
 * `node:` built-ins.
 *
 * - `test/gateway/msw.ts` wraps these as MSW handlers for Vitest (the workflow
 *   tier, where `vi.mock` cannot reach step code).
 * - `e2e/stubs/gateway-stub.ts` serves them from a plain Node server for
 *   Playwright, loaded under `node --experimental-strip-types`.
 *
 * The protocol, in short:
 *
 * - `POST <base>/language-model`, header `ai-language-model-id` names the model
 *   and `ai-language-model-streaming: true|false` picks the answer: a JSON
 *   `LanguageModelV3` generate result, or SSE `data: <stream part>` lines.
 * - `POST <base>/image-model`, header `ai-model-id`; body `{ prompt, n,
 *   providerOptions, files }`; answer `{ images: [base64], warnings,
 *   providerMetadata }`.
 * - A failure is any non-2xx status with `{ error: { message, type } }`; `type`
 *   picks the provider's error class (`model_not_found`,
 *   `rate_limit_exceeded`, `authentication_error`, `internal_server_error`, …).
 * - Provider-executed tools (`exa_search`) arrive as `{ type: "provider", name,
 *   id: "gateway.exa_search", args }` and come back already run: a `tool-call`
 *   with `providerExecuted: true` followed by its `tool-result`.
 */

export const GATEWAY_DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v3/ai";
export const LANGUAGE_MODEL_PATH = "/language-model";
export const IMAGE_MODEL_PATH = "/image-model";
/** The embedding endpoint (`GatewayEmbeddingModel`): `{ values, providerOptions? }` in, `{ embeddings, usage, providerMetadata }` out. */
export const EMBEDDING_MODEL_PATH = "/embedding-model";

/** An embedding request as the Gateway receives it. */
export interface ParsedEmbeddingRequest {
  modelId: string | null;
  values: string[];
  providerOptions: Record<string, unknown> | undefined;
}

export function parseEmbeddingRequest(headers: HeadersLike, body: unknown): ParsedEmbeddingRequest {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  return {
    modelId: header(headers, "ai-model-id") ?? null,
    values: Array.isArray(record.values) ? record.values.map(String) : [],
    providerOptions: record.providerOptions as Record<string, unknown> | undefined,
  };
}

/** The Gateway's embedding response body. */
export interface WireEmbeddingBody {
  embeddings: number[][];
  usage?: { tokens: number };
  providerMetadata?: { gateway?: { cost?: string } };
}

// ── Requests ──────────────────────────────────────────────────────────

/** `Headers` (fetch, MSW) or a plain record (Node's `IncomingMessage.headers`). */
export type HeadersLike = Headers | Record<string, string | string[] | undefined>;

export interface WireTool {
  type: "function" | "provider";
  name: string;
  /** Provider tools only, e.g. `gateway.exa_search`. */
  id?: string;
  /** Provider tools' configuration, e.g. Exa's `numResults`. */
  args?: unknown;
}

export interface WirePart {
  type: string;
  text?: string;
  mediaType?: string;
  data?: unknown;
  filename?: string;
  [key: string]: unknown;
}

export interface WireMessage {
  role: string;
  /** A string for `system`; parts for everyone else. */
  content: string | WirePart[];
}

export interface ParsedLanguageRequest {
  modelId: string;
  streaming: boolean;
  tools: WireTool[];
  prompt: WireMessage[];
  /** Every key found under any `providerOptions` anywhere in the body — top level or on a part. */
  providerOptionsSeen: string[];
  /** The whole body, for anything the fields above do not cover. */
  body: unknown;
}

export interface WireFile {
  mediaType: string;
  /** A data URL, bare base64 or a URL, exactly as it was sent. */
  data: string;
  filename?: string;
}

export interface ParsedImageRequest {
  modelId: string;
  prompt: string | null;
  n: number;
  providerOptions: Record<string, Record<string, unknown>>;
  providerOptionsSeen: string[];
  files: WireFile[];
  body: unknown;
}

export function header(headers: HeadersLike, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? undefined;
  const record = headers as Record<string, string | string[] | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

export function parseLanguageRequest(headers: HeadersLike, body: unknown): ParsedLanguageRequest {
  const record = asRecord(body);
  const tools = Array.isArray(record.tools)
    ? record.tools.map((raw): WireTool => {
        const tool = asRecord(raw);
        return {
          type: tool.type === "provider" ? "provider" : "function",
          name: String(tool.name ?? ""),
          ...(typeof tool.id === "string" ? { id: tool.id } : {}),
          ...(tool.args !== undefined ? { args: tool.args } : {}),
        };
      })
    : [];
  const prompt = Array.isArray(record.prompt) ? (record.prompt as WireMessage[]) : [];
  return {
    modelId: header(headers, "ai-language-model-id") ?? "",
    streaming: header(headers, "ai-language-model-streaming") === "true",
    tools,
    prompt,
    providerOptionsSeen: providerOptionKeys(body),
    body,
  };
}

export function parseImageRequest(headers: HeadersLike, body: unknown): ParsedImageRequest {
  const record = asRecord(body);
  const files = Array.isArray(record.files)
    ? record.files.map((raw) => {
        const file = asRecord(raw);
        return {
          mediaType: String(file.mediaType ?? ""),
          data: typeof file.data === "string" ? file.data : String(asRecord(file.data).href ?? ""),
          ...(typeof file.filename === "string" ? { filename: file.filename } : {}),
        };
      })
    : [];
  return {
    modelId: header(headers, "ai-model-id") ?? "",
    prompt: typeof record.prompt === "string" ? record.prompt : null,
    n: typeof record.n === "number" ? record.n : 1,
    providerOptions: asRecord(record.providerOptions) as Record<string, Record<string, unknown>>,
    providerOptionsSeen: providerOptionKeys(body),
    files,
    body,
  };
}

/** Every text in the prompt — the system message and every text part — joined by newlines. */
export function promptText(req: { prompt: WireMessage[] }): string {
  const texts: string[] = [];
  for (const message of req.prompt) {
    if (typeof message.content === "string") texts.push(message.content);
    else for (const part of message.content) if (part.type === "text" && typeof part.text === "string") texts.push(part.text);
  }
  return texts.join("\n");
}

/** True when any message carries an image — the image ranking call. */
export function promptHasImage(req: { prompt: WireMessage[] }): boolean {
  return promptFiles(req, "image/").length > 0;
}

/** The file parts whose media type starts with `mediaTypePrefix` (e.g. `application/pdf`, `image/`). */
export function promptFiles(req: { prompt: WireMessage[] }, mediaTypePrefix: string): WireFile[] {
  const files: WireFile[] = [];
  for (const message of req.prompt) {
    if (typeof message.content === "string") continue;
    for (const part of message.content) {
      if (part.type !== "file" || typeof part.mediaType !== "string" || !part.mediaType.startsWith(mediaTypePrefix)) continue;
      const data = typeof part.data === "string" ? part.data : String(asRecord(part.data).href ?? "");
      files.push({ mediaType: part.mediaType, data, ...(part.filename ? { filename: part.filename } : {}) });
    }
  }
  return files;
}

/** The raw bytes of a file part's data (a data URL or bare base64). URLs are not fetched: null. */
export function fileBytes(file: WireFile): Uint8Array | null {
  const match = /^data:[^;,]*(?:;[^,]*)?;base64,([\s\S]*)$/.exec(file.data);
  const base64 = match ? match[1] : /^[A-Za-z0-9+/=\s]+$/.test(file.data) ? file.data : null;
  return base64 === null ? null : new Uint8Array(Buffer.from(base64, "base64"));
}

// ── Answers ───────────────────────────────────────────────────────────

export type FinishReason = "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other";

export interface WireUsage {
  inputTokens: { total: number; noCache: number; cacheRead: number; cacheWrite: number };
  outputTokens: { total: number; text: number; reasoning: number };
}

/** A non-streaming `/language-model` answer: a `LanguageModelV3` generate result. */
export interface WireLanguageBody {
  content: Record<string, unknown>[];
  finishReason: { unified: FinishReason };
  usage: WireUsage;
  providerMetadata: Record<string, Record<string, unknown>>;
  warnings: unknown[];
}

/** One SSE event of a streaming answer: a `LanguageModelV3StreamPart`. */
export type WireStreamPart = { type: string; [key: string]: unknown };

/** A `/image-model` answer. */
export interface WireImageBody {
  images: string[];
  warnings: unknown[];
  providerMetadata: Record<string, Record<string, unknown>>;
}

/** A failure: the status to answer with and the Gateway's error body. */
export interface WireError {
  status: number;
  body: { error: { message: string; type: string } };
  /** Response headers to send with it, e.g. `retry-after`. */
  headers?: Record<string, string>;
}

export const STUB_USAGE: WireUsage = {
  inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 20, text: 20, reasoning: 0 },
};

let sequence = 0;
function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}_stub_${sequence.toString(36)}`;
}

function gatewayMetadata(extra: Record<string, unknown> = {}): Record<string, Record<string, unknown>> {
  return { gateway: { cost: "0", generationId: nextId("gen"), ...extra } };
}

/** The model answers with text. */
export function textResponse(text: string): WireLanguageBody {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop" },
    usage: STUB_USAGE,
    providerMetadata: gatewayMetadata(),
    warnings: [],
  };
}

/** The model calls function tools — ours to run; the SDK comes back with the results. */
export function toolCallResponse(
  calls: readonly { toolName: string; input: unknown; toolCallId?: string }[]
): WireLanguageBody {
  return {
    content: calls.map((call) => ({
      type: "tool-call",
      toolCallId: call.toolCallId ?? nextId("call"),
      toolName: call.toolName,
      // A JSON string on the wire, as the Gateway sends it.
      input: JSON.stringify(call.input),
    })),
    finishReason: { unified: "tool-calls" },
    usage: STUB_USAGE,
    providerMetadata: gatewayMetadata(),
    warnings: [],
  };
}

export interface ExaStubResult {
  url: string;
  title: string;
  /** The page's text, as research's `contents.text` asks for. */
  text?: string;
  highlights?: string[];
  image?: string | null;
  imageLinks?: string[];
}

/**
 * The model searched with Exa — run by the Gateway, so it arrives already done:
 * the provider-executed call, its result, then the model's text. Shaped as
 * fixture `check2-exa-01.json`.
 */
export function exaSearchResponse({
  query,
  results,
  text,
}: {
  query: string;
  results: readonly ExaStubResult[];
  text: string;
}): WireLanguageBody {
  const toolCallId = nextId("call");
  return {
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName: "exa_search",
        input: JSON.stringify({ query, num_results: results.length }),
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId,
        toolName: "exa_search",
        toolType: "exa_search",
        result: {
          requestId: nextId("exa"),
          resolvedSearchType: "",
          results: results.map((r) => ({
            id: r.url,
            title: r.title,
            url: r.url,
            ...(r.text !== undefined ? { text: r.text } : {}),
            highlights: r.highlights ?? [],
            ...(r.image !== undefined ? { image: r.image } : {}),
            ...(r.imageLinks ? { extras: { imageLinks: r.imageLinks } } : {}),
          })),
          searchTime: 1,
          costDollars: { total: 0.007, search: { neural: 0.007 } },
        },
        isError: false,
        providerExecuted: true,
      },
      { type: "text", text },
    ],
    finishReason: { unified: "stop" },
    usage: STUB_USAGE,
    providerMetadata: gatewayMetadata({ gatewayToolCalls: { exa_search: 1 } }),
    warnings: [],
  };
}

/** SSE text for stream parts: one `data:` line each, as the Gateway sends them. */
export function sseBody(parts: readonly WireStreamPart[]): string {
  return parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
}

function streamHead(): WireStreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: nextId("resp"), modelId: "stub", timestamp: new Date(0).toISOString() },
  ];
}

function finishPart(reason: FinishReason): WireStreamPart {
  return { type: "finish", finishReason: { unified: reason }, usage: STUB_USAGE, providerMetadata: gatewayMetadata() };
}

/** A streamed text answer, a few characters per delta. Shaped as fixture `check5-streaming-02.json`. */
export function streamedText(text: string): WireStreamPart[] {
  const id = nextId("msg");
  return [...streamHead(), ...textParts(id, text), finishPart("stop")];
}

/** A streamed function-tool call, its input streamed as JSON fragments. Shaped as `check5-streaming-01.json`. */
export function streamedToolCall(toolCallId: string, toolName: string, input: unknown): WireStreamPart[] {
  return [...streamHead(), ...toolCallParts(toolCallId, toolName, JSON.stringify(input)), finishPart("tool-calls")];
}

function textParts(id: string, text: string): WireStreamPart[] {
  const deltas = text.match(/[\s\S]{1,8}/g) ?? [];
  return [
    { type: "text-start", id },
    ...deltas.map((delta) => ({ type: "text-delta", id, delta })),
    { type: "text-end", id },
  ];
}

function toolCallParts(id: string, toolName: string, input: string, extra: Record<string, unknown> = {}): WireStreamPart[] {
  const deltas = input.match(/[\s\S]{1,6}/g) ?? [];
  return [
    { type: "tool-input-start", id, toolName, ...extra },
    ...deltas.map((delta) => ({ type: "tool-input-delta", id, delta })),
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input, ...extra },
  ];
}

/** A generate result as stream parts — what a streaming request gets when a stub answered with a body. */
export function toStreamParts(body: WireLanguageBody): WireStreamPart[] {
  const parts = streamHead();
  for (const item of body.content) {
    if (item.type === "text") parts.push(...textParts(nextId("msg"), String(item.text ?? "")));
    else if (item.type === "tool-call") {
      const input = typeof item.input === "string" ? item.input : JSON.stringify(item.input);
      const extra = item.providerExecuted ? { providerExecuted: true } : {};
      parts.push(...toolCallParts(String(item.toolCallId), String(item.toolName), input, extra));
    } else parts.push(item as WireStreamPart);
  }
  parts.push({ ...finishPart(body.finishReason.unified), providerMetadata: body.providerMetadata });
  return parts;
}

/** Stream parts as a generate result — what a non-streaming request gets when a stub answered with parts. */
export function fromStreamParts(parts: readonly WireStreamPart[]): WireLanguageBody {
  const content: Record<string, unknown>[] = [];
  const texts = new Map<string, Record<string, unknown>>();
  let finishReason: FinishReason = "stop";
  for (const part of parts) {
    if (part.type === "text-start") {
      const text = { type: "text", text: "" };
      texts.set(String(part.id), text);
      content.push(text);
    } else if (part.type === "text-delta") {
      const text = texts.get(String(part.id));
      if (text) text.text = String(text.text) + String(part.delta ?? "");
    } else if (part.type === "tool-call" || part.type === "tool-result") {
      content.push({ ...part });
    } else if (part.type === "finish") {
      finishReason = (asRecord(part.finishReason).unified as FinishReason) ?? "stop";
    }
  }
  return { content, finishReason: { unified: finishReason }, usage: STUB_USAGE, providerMetadata: gatewayMetadata(), warnings: [] };
}

/** An image-model answer: base64 PNGs, as OpenAI returns them through the Gateway. */
export function imageResponse(base64Pngs: readonly string[]): WireImageBody {
  return {
    images: [...base64Pngs],
    warnings: [],
    providerMetadata: {
      openai: {
        images: base64Pngs.map(() => ({ size: "1536x1024", quality: "high", background: "transparent", outputFormat: "png" })),
      },
      ...gatewayMetadata({ cost: "0.050808" }),
    },
  };
}

/** A Gateway failure. `type` picks the provider's error class, e.g. `model_not_found`. */
export function errorBody(status: number, type: string, message: string, headers?: Record<string, string>): WireError {
  return { status, body: { error: { message, type } }, ...(headers ? { headers } : {}) };
}

export function isWireError(value: unknown): value is WireError {
  const record = asRecord(value);
  return typeof record.status === "number" && typeof asRecord(record.body).error === "object";
}

// ── Helpers ───────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/** Every key of every `providerOptions` object anywhere in `value`, first-seen order. */
function providerOptionKeys(value: unknown): string[] {
  const seen: string[] = [];
  const visit = (node: unknown, depth: number) => {
    if (depth > 20 || typeof node !== "object" || node === null) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "providerOptions" && typeof child === "object" && child !== null) {
        for (const provider of Object.keys(child)) if (!seen.includes(provider)) seen.push(provider);
      }
      visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return seen;
}
