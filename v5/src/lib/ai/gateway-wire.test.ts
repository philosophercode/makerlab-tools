// @vitest-environment node
import { GatewayModelNotFoundError } from "@ai-sdk/gateway";
import { generateImage, generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { gatewayHandlers } from "../../../test/gateway/msw";
import { makePng } from "../../../test/gateway/png";
import {
  GATEWAY_DEFAULT_BASE_URL,
  errorBody,
  exaSearchResponse,
  fileBytes,
  imageResponse,
  promptFiles,
  promptHasImage,
  promptText,
  streamedText,
  streamedToolCall,
  textResponse,
  type ParsedImageRequest,
  type ParsedLanguageRequest,
} from "../../../test/gateway/wire";
import { server } from "../../../test/msw/server";
import { EXA_SEARCH_TOOL, countExaCalls, exaImageHints, exaPageTexts, researchExaSearch } from "./exa";
import { classifyModelError } from "./gateway-errors";
import { gatewayProvider, languageModelFor } from "./models";

/**
 * The round trip (gateway spec §10): the wire builders in `test/gateway/wire.ts`
 * are exactly what the real `@ai-sdk/gateway` provider sends and parses. If the
 * provider's wire format moves under a version bump, this is the file that
 * fails — not the workflow tier or the E2E stub, which both trust the builders.
 *
 * Real provider, real `ai` functions, MSW at the Gateway's URL. The provider
 * builds its Authorization header from `AI_GATEWAY_API_KEY`, so a placeholder
 * is stubbed; nothing checks it and nothing leaves the process.
 */

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
  vi.stubEnv("AI_GATEWAY_BASE_URL", "");
  for (const name of ["MODEL_CHAT", "MODEL_RESEARCH_SEARCH", "MODEL_RESEARCH_READ", "MODEL_IMAGE_RANK"]) {
    vi.stubEnv(name, "");
  }
});

describe("the Gateway wire round trip", () => {
  it("generateText parses textResponse, and the request carries the job's model id", async () => {
    const seen: ParsedLanguageRequest[] = [];
    server.use(
      ...gatewayHandlers({
        language: (req) => {
          seen.push(req);
          return textResponse("A masked-SLA resin printer.");
        },
      })
    );

    const result = await generateText({
      model: languageModelFor("researchRead"),
      system: "You are terse.",
      prompt: "What is a Form 4?",
      maxRetries: 0,
    });

    expect(result.text).toBe("A masked-SLA resin printer.");
    expect(result.finishReason).toBe("stop");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ modelId: "openai/gpt-6-luna", streaming: false, tools: [], providerOptionsSeen: [] });
    expect(promptText(seen[0])).toBe("You are terse.\nWhat is a Form 4?");
  });

  it("generateText parses exaSearchResponse; countExaCalls, exaImageHints and exaPageTexts read result.steps", async () => {
    const seen: ParsedLanguageRequest[] = [];
    server.use(
      ...gatewayHandlers({
        language: (req) => {
          seen.push(req);
          return exaSearchResponse({
            query: "Bambu Lab P1S",
            results: [
              {
                url: "https://bambulab.com/en/p1",
                title: "P1S",
                text: "Bambu Lab P1S. Enclosed CoreXY 3D printer, 256 × 256 × 256 mm.",
                highlights: ["Enclosed CoreXY"],
                image: "https://cdn.bambulab.com/p1s-og.jpg",
                imageLinks: ["https://cdn.bambulab.com/p1s-front.png"],
              },
              { url: "https://shop.test/p1s", title: "P1S at a shop", image: null },
            ],
            text: "The P1S is an enclosed CoreXY printer.",
          });
        },
      })
    );

    const result = await generateText({
      model: languageModelFor("researchSearch"),
      tools: { [EXA_SEARCH_TOOL]: researchExaSearch() },
      prompt: "Find the Bambu Lab P1S.",
      stopWhen: stepCountIs(3),
      maxRetries: 0,
    });

    // One HTTP request: the Gateway ran the search itself.
    expect(seen).toHaveLength(1);
    expect(seen[0].tools).toEqual([
      {
        type: "provider",
        name: "exa_search",
        id: "gateway.exa_search",
        args: { numResults: 6, contents: { text: { maxCharacters: 12000 }, highlights: true, extras: { imageLinks: 3 } } },
      },
    ]);
    expect(result.text).toBe("The P1S is an enclosed CoreXY printer.");
    expect(countExaCalls(result.steps)).toBe(1);
    expect(exaImageHints(result.steps)).toEqual([
      { url: "https://cdn.bambulab.com/p1s-og.jpg", source: "exa", pageUrl: "https://bambulab.com/en/p1" },
      { url: "https://cdn.bambulab.com/p1s-front.png", source: "exa", pageUrl: "https://bambulab.com/en/p1" },
    ]);
    // The page text research asked for survives the wire, for the read step's fallback.
    expect(exaPageTexts(result.steps)).toEqual([
      { url: "https://bambulab.com/en/p1", title: "P1S", text: "Bambu Lab P1S. Enclosed CoreXY 3D printer, 256 × 256 × 256 mm." },
    ]);
  });

  it("streamText parses streamedToolCall then streamedText, running our tool in between", async () => {
    const seen: ParsedLanguageRequest[] = [];
    server.use(
      ...gatewayHandlers({
        language: (req, call) => {
          seen.push(req);
          return call === 0 ? streamedToolCall("call_1", "get_unit_details", { unitId: "U-7" }) : streamedText("Unit U-7 is available.");
        },
      })
    );
    const execute = vi.fn(async ({ unitId }: { unitId: string }) => ({ unitId, status: "available" }));

    const result = streamText({
      model: languageModelFor("chat"),
      tools: {
        get_unit_details: tool({ description: "Look up a unit.", inputSchema: z.object({ unitId: z.string() }), execute }),
      },
      prompt: "Is U-7 free?",
      stopWhen: stepCountIs(3),
      maxRetries: 0,
    });

    expect(await result.text).toBe("Unit U-7 is available.");
    expect(execute).toHaveBeenCalledWith({ unitId: "U-7" }, expect.anything());
    expect(seen.map((req) => req.streaming)).toEqual([true, true]);
    expect(seen[0].tools).toEqual([expect.objectContaining({ type: "function", name: "get_unit_details" })]);
    // The second request carries our tool result back.
    expect(JSON.stringify(seen[1].prompt)).toContain('"status":"available"');
  });

  it("generateText sends PDF and image file parts the way promptFiles reads them", async () => {
    const seen: ParsedLanguageRequest[] = [];
    server.use(...gatewayHandlers({ language: (req) => (seen.push(req), textResponse("ok")) }));
    const pdf = new TextEncoder().encode("%PDF-1.4 minimal");
    const png = makePng({ width: 4, height: 4, alpha: false });

    await generateText({
      model: languageModelFor("imageRank"),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Rank these." },
            { type: "file", mediaType: "application/pdf", data: pdf },
            { type: "image", image: png, mediaType: "image/png" },
          ],
        },
      ],
      maxRetries: 0,
    });

    const [pdfPart] = promptFiles(seen[0], "application/pdf");
    expect(fileBytes(pdfPart)).toEqual(pdf);
    expect(promptHasImage(seen[0])).toBe(true);
    expect(fileBytes(promptFiles(seen[0], "image/")[0])).toEqual(png);
  });

  // No job uses an image model since the generative redraw was retired (spec
  // amendment "No generative redraw"); the image wire builders are kept, and
  // checked here against a model built by id, for the Phase 0 fixtures.
  it("generateImage sends the edit request and parses imageResponse", async () => {
    const seen: ParsedImageRequest[] = [];
    const cleaned = makePng({ width: 64, height: 48, alpha: true });
    server.use(
      ...gatewayHandlers({
        image: (req) => {
          seen.push(req);
          return imageResponse([Buffer.from(cleaned).toString("base64")]);
        },
      })
    );
    const original = makePng({ width: 32, height: 24, alpha: false });

    const result = await generateImage({
      model: gatewayProvider().imageModel("openai/gpt-image-1-mini"),
      prompt: { images: [original], text: "Remove the background." },
      providerOptions: { openai: { background: "transparent", output_format: "png" } },
      maxRetries: 0,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      modelId: "openai/gpt-image-1-mini",
      prompt: "Remove the background.",
      n: 1,
      providerOptions: { openai: { background: "transparent", output_format: "png" } },
      providerOptionsSeen: ["openai"],
    });
    expect(seen[0].files).toHaveLength(1);
    expect(fileBytes(seen[0].files[0])).toEqual(original);
    expect(result.image.uint8Array).toEqual(cleaned);
  });

  it("surfaces a model_not_found errorBody as GatewayModelNotFoundError, classified model_not_found", async () => {
    vi.stubEnv("MODEL_RESEARCH_READ", "openai/gpt-7-imaginary");
    server.use(...gatewayHandlers({ language: () => errorBody(404, "model_not_found", "Model not found") }));

    let thrown: unknown;
    try {
      await generateText({ model: languageModelFor("researchRead"), prompt: "hi", maxRetries: 0 });
    } catch (error) {
      thrown = error;
    }

    expect(GatewayModelNotFoundError.isInstance(thrown)).toBe(true);
    expect(classifyModelError(thrown)).toMatchObject({ kind: "model_not_found", statusCode: 404 });
  });

  it("classifies a rate-limit errorBody, with its Retry-After, even after the SDK's retries", async () => {
    // retry-after-ms keeps the SDK's one retry from waiting its default two seconds.
    server.use(
      ...gatewayHandlers({ language: () => errorBody(429, "rate_limit_exceeded", "Slow down", { "retry-after-ms": "5" }) })
    );

    let thrown: unknown;
    try {
      await generateText({ model: languageModelFor("chat"), prompt: "hi", maxRetries: 1 });
    } catch (error) {
      thrown = error;
    }

    expect(classifyModelError(thrown)).toMatchObject({ kind: "rate_limited", statusCode: 429, retryAfterMs: 5 });
  });

  it("targets the default base URL unless AI_GATEWAY_BASE_URL says otherwise", async () => {
    vi.stubEnv("AI_GATEWAY_BASE_URL", "http://localhost:3103/v3/ai");
    server.use(...gatewayHandlers({ language: () => textResponse("stubbed") }, "http://localhost:3103/v3/ai"));

    const result = await generateText({ model: languageModelFor("chat"), prompt: "hi", maxRetries: 0 });

    expect(result.text).toBe("stubbed");
    expect(GATEWAY_DEFAULT_BASE_URL).toBe("https://ai-gateway.vercel.sh/v3/ai");
    expect(gatewayProvider()).toBe(gatewayProvider());
  });
});
