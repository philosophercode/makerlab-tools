import { http, HttpResponse } from "msw";
import {
  EMBEDDING_MODEL_PATH,
  GATEWAY_DEFAULT_BASE_URL,
  IMAGE_MODEL_PATH,
  parseEmbeddingRequest,
  type ParsedEmbeddingRequest,
  type WireEmbeddingBody,
  LANGUAGE_MODEL_PATH,
  fromStreamParts,
  isWireError,
  parseImageRequest,
  parseLanguageRequest,
  sseBody,
  toStreamParts,
  type ParsedImageRequest,
  type ParsedLanguageRequest,
  type WireError,
  type WireImageBody,
  type WireLanguageBody,
  type WireStreamPart,
} from "./wire";

/**
 * The Vercel AI Gateway as MSW handlers — for tests that stub the model at the
 * HTTP boundary rather than through `test/ai/models-stub.ts`: the workflow tier
 * (where `vi.mock` does not reach step code) and the wire round trip.
 *
 * ```ts
 * server.use(
 *   ...gatewayHandlers({
 *     language: (req) => (promptHasImage(req) ? textResponse('{"order":[0],"reasons":["front"]}') : textResponse("hi")),
 *     image: () => imageResponse([makePngBase64({ width: 1024, height: 1024, alpha: true })]),
 *   })
 * );
 * ```
 *
 * A language handler may answer with a generate result, stream parts, or an
 * `errorBody(...)`; the handler answers in whichever form the request asked for
 * (`ai-language-model-streaming`), converting between the two when it has to.
 * Only the handlers given are registered, so an unexpected image call fails the
 * test as an unhandled request rather than being answered by accident. The
 * second argument is the 0-based index of the call to that endpoint.
 *
 * The provider needs credentials to build its headers, so a test stubs
 * `AI_GATEWAY_API_KEY` (any value) — the handlers never check it.
 */

export type LanguageReply = WireLanguageBody | WireStreamPart[] | WireError;
export type ImageReply = WireImageBody | WireError;

export type EmbeddingReply = WireEmbeddingBody | WireError;

export interface GatewayStubs {
  language?: (req: ParsedLanguageRequest, callIndex: number) => LanguageReply | Promise<LanguageReply>;
  image?: (req: ParsedImageRequest, callIndex: number) => ImageReply | Promise<ImageReply>;
  /** Job `embed` (manual passages and queries). */
  embedding?: (req: ParsedEmbeddingRequest, callIndex: number) => EmbeddingReply | Promise<EmbeddingReply>;
}

export function gatewayHandlers(stubs: GatewayStubs, baseUrl: string = GATEWAY_DEFAULT_BASE_URL) {
  const base = baseUrl.replace(/\/+$/, "");
  const handlers = [];

  if (stubs.language) {
    const answer = stubs.language;
    let calls = 0;
    handlers.push(
      http.post(`${base}${LANGUAGE_MODEL_PATH}`, async ({ request }) => {
        const req = parseLanguageRequest(request.headers, await request.json());
        const reply = await answer(req, calls++);
        if (isWireError(reply)) return HttpResponse.json(reply.body, { status: reply.status, headers: reply.headers });
        if (req.streaming) {
          const parts = Array.isArray(reply) ? reply : toStreamParts(reply);
          return new HttpResponse(sseBody(parts), {
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          });
        }
        return HttpResponse.json(Array.isArray(reply) ? fromStreamParts(reply) : reply);
      })
    );
  }

  if (stubs.image) {
    const answer = stubs.image;
    let calls = 0;
    handlers.push(
      http.post(`${base}${IMAGE_MODEL_PATH}`, async ({ request }) => {
        const req = parseImageRequest(request.headers, await request.json());
        const reply = await answer(req, calls++);
        if (isWireError(reply)) return HttpResponse.json(reply.body, { status: reply.status, headers: reply.headers });
        return HttpResponse.json(reply);
      })
    );
  }

  if (stubs.embedding) {
    const answer = stubs.embedding;
    let calls = 0;
    handlers.push(
      http.post(`${base}${EMBEDDING_MODEL_PATH}`, async ({ request }) => {
        const req = parseEmbeddingRequest(request.headers, await request.json());
        const reply = await answer(req, calls++);
        if (isWireError(reply)) return HttpResponse.json(reply.body, { status: reply.status, headers: reply.headers });
        return HttpResponse.json(reply);
      })
    );
  }

  return handlers;
}
