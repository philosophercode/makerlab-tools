import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  errorBody,
  exaSearchResponse,
  fromStreamParts,
  LANGUAGE_MODEL_PATH,
  parseLanguageRequest,
  promptFiles,
  promptHasImage,
  promptText,
  sseBody,
  streamedText,
  streamedToolCall,
  textResponse,
  toStreamParts,
  type ParsedLanguageRequest,
  type WireLanguageBody,
  type WireStreamPart,
} from "../../test/gateway/wire.ts";
import { makeProductPng } from "../../test/gateway/png.ts";
import {
  AFTER_TABLE_REPLY,
  ASK_FOR_ITEMS_REPLY,
  GATEWAY_STUB_ORIGIN,
  GATEWAY_STUB_PORT,
  INTAKE_ITEMS,
  type IntakeFixtureItem,
} from "./intake-fixture.ts";

/**
 * A stand-in for the Vercel AI Gateway, for the intake E2E only (gateway spec
 * §10, E2E scenario 5 — formerly the data platform spec's; this file replaces
 * `anthropic-stub.ts`, which answered the Anthropic Messages API directly and
 * is retired now that every model call goes through the Gateway).
 *
 * Every other spec intercepts `/api/chat` in the browser, which cannot reach
 * what scenario 5 needs: `identify_tools` writing real pending rows, and the
 * research workflow's steps running server-side minutes after the click. So
 * the Playwright server boots with `AI_GATEWAY_BASE_URL` pointing here (plus a
 * fake `AI_GATEWAY_API_KEY`) and the model is stubbed **at the Gateway's own
 * wire format** — `test/gateway/wire.ts`, the same builders MSW uses for the
 * Vitest workflow tier (`test/gateway/msw.ts`), served here from plain
 * `node:http` instead, since `vi.mock` cannot reach a Playwright-booted
 * server. Everything between the browser and this process is the real app:
 * the chat route, the capability, the routes, the workflow on the local
 * world, link verification, the image stage.
 *
 * Requests are told apart the way the app actually shapes them (gateway spec
 * §10, "E2E stub classification"), not by trying to read intent from a model
 * id:
 *
 * - **streaming** `POST /v3/ai/language-model` → **the chat**. The header's
 *   Add seed ("I'd like to add new equipment…") gets {@link ASK_FOR_ITEMS_REPLY};
 *   the turn whose last message already carries a `tool-result` (the AI SDK's
 *   follow-up request after running `identify_tools` itself) gets
 *   {@link AFTER_TABLE_REPLY}; anything else — the `IDENTIFY_PROMPT` message —
 *   gets one `identify_tools` tool call with the three {@link INTAKE_ITEMS},
 *   using the same input `anthropic-stub.ts` used to send. `exa_search` and
 *   `read_page` may both be in the tool list here too (the chat route adds
 *   them the way it once added `web_search`/`web_fetch`); this stub ignores
 *   them for chat, since only the message content decides the answer.
 * - **non-streaming, tools include `exa_search`** → **research, search step**.
 *   An `exaSearchResponse` whose results point at this server's own product
 *   page and manual, plus the same findings JSON `anthropic-stub.ts` returned,
 *   as the trailing text.
 * - **non-streaming, an image part in the prompt** → **image ranking**. A
 *   strict `{"order": number[], "reasons": string[]}`, sized to how many
 *   images the prompt actually carried.
 * - **non-streaming, anything else** (no tools, `"Name: <item>"` in the
 *   prompt) → **research, read step**. The same draft JSON as before.
 * - There is no `/image-model` route: background removal is a deterministic
 *   cutout in the app (`src/lib/research/images/clean.ts`), not a model call.
 *   The product image this stub serves is a product on a plain white
 *   backdrop, so the intake scenario's server — which has a local Blob folder
 *   (`BLOB_LOCAL_DIR`, `playwright.config.ts`) — cuts it out and stores the
 *   cleaned copy.
 *
 * It also serves the product pages, their `og:image`, and the manual PDF, so
 * link verification and the read step's own page fetches open real URLs on
 * this machine and find them — no request leaves it. `READ_PAGE_TEST_ORIGIN`
 * (set to this origin in `playwright.config.ts`) is what lets the app's SSRF
 * guard (`src/lib/web/address-guard.ts`) fetch a loopback address at all.
 */

// ── Reading a request body ──────────────────────────────────────────────

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Answer a language-model request in whichever form it asked for — SSE or JSON — mirroring `test/gateway/msw.ts`. */
function sendLanguageReply(
  res: ServerResponse,
  streaming: boolean,
  reply: WireLanguageBody | WireStreamPart[]
): void {
  if (streaming) {
    const parts = Array.isArray(reply) ? reply : toStreamParts(reply);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    res.end(sseBody(parts));
    return;
  }
  const body = Array.isArray(reply) ? fromStreamParts(reply) : reply;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendBadJson(res: ServerResponse): void {
  const { status, body } = errorBody(400, "invalid_request_error", "not JSON");
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// ── The chat ─────────────────────────────────────────────────────────────

/** The `identify_tools` input, matching `anthropic-stub.ts`'s (intake capability contract, `identify_tools`). */
function identifyToolInput() {
  return {
    items: Object.values(INTAKE_ITEMS).map((item) => ({
      name: item.identifiedAs,
      brand: item.brand,
      categoryHint: item.categoryHint,
      attachmentIds: [],
    })),
  };
}

/** The text of the last message's text parts only — what the person (or the tool result's caller) most recently said. */
function lastMessageText(req: ParsedLanguageRequest): string {
  const last = req.prompt.at(-1);
  if (!last) return "";
  if (typeof last.content === "string") return last.content;
  return last.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join(" ");
}

/** True once the AI SDK has run `identify_tools` itself and is sending the result back. */
function lastMessageHasToolResult(req: ParsedLanguageRequest): boolean {
  const last = req.prompt.at(-1);
  if (!last || typeof last.content === "string") return false;
  return last.content.some((part) => part.type === "tool-result");
}

function answerChat(req: ParsedLanguageRequest): WireStreamPart[] {
  if (lastMessageHasToolResult(req)) return streamedText(AFTER_TABLE_REPLY);
  const said = lastMessageText(req);
  if (/add new equipment/i.test(said)) return streamedText(ASK_FOR_ITEMS_REPLY);
  return streamedToolCall("call_identify_e2e", "identify_tools", identifyToolInput());
}

// ── Research ─────────────────────────────────────────────────────────────

/** The key `researchExaSearch()` registers its tool under (`src/lib/ai/exa.ts`'s `EXA_SEARCH_TOOL`). Not imported — this file stays dependency-free — but pinned to the same literal by contract (C3). */
const EXA_SEARCH_TOOL_NAME = "exa_search";

function pagesFor(item: IntakeFixtureItem) {
  return {
    product: `${GATEWAY_STUB_ORIGIN}/products/${item.slug}`,
    manual: `${GATEWAY_STUB_ORIGIN}/manuals/${item.slug}.pdf`,
    image: `${GATEWAY_STUB_ORIGIN}/img/${item.slug}.png`,
  };
}

/** Which fixture item a research prompt is about — by the name it carries, exactly as `anthropic-stub.ts` matched it. */
function itemIn(raw: string): IntakeFixtureItem | null {
  for (const item of Object.values(INTAKE_ITEMS)) {
    if (raw.includes(item.name) || raw.includes(item.identifiedAs)) return item;
  }
  return null;
}

/** Research that recognises nothing finds nothing, which grades low — never an invented page (spec §5.4). Parses under both the search and the read step's tolerant schemas (every field they don't recognise has a default). */
const NOT_FOUND = { canonicalName: "", description: "", candidateLinks: [], sourceUrls: [] };

function searchFindings(item: IntakeFixtureItem) {
  const pages = pagesFor(item);
  return {
    canonicalName: item.name,
    description: `The ${item.name}, from ${item.brand}.`,
    category: { name: item.categoryHint, group: null },
    candidateLinks: [{ title: `${item.name} user manual`, url: pages.manual, type: "Manual" }],
    sourceUrls: [pages.product],
    evidence: { userStatedModel: true, manufacturerPageFound: true },
  };
}

function fetchDraft(item: IntakeFixtureItem) {
  const pages = pagesFor(item);
  return {
    canonicalName: item.name,
    description: `The ${item.name}, from ${item.brand}.`,
    specs: [{ label: "Maker", value: item.brand }],
    materials: ["Hardwood"],
    ppeRequired: ["Safety glasses"],
    tags: [],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: item.categoryHint, group: null },
    resources: [{ title: `${item.name} user manual`, url: pages.manual, type: "Manual" }],
    sourceUrls: [pages.product],
    evidence: {
      userStatedModel: true,
      manufacturerPageFound: true,
      manualFound: true,
      specsFromSource: true,
    },
  };
}

function answerResearchSearch(req: ParsedLanguageRequest): WireLanguageBody {
  const item = itemIn(promptText(req));
  if (!item) return textResponse(JSON.stringify(NOT_FOUND));
  const pages = pagesFor(item);
  return exaSearchResponse({
    query: item.name,
    results: [
      {
        url: pages.product,
        title: `${item.name} product page`,
        highlights: [`The ${item.name}, from ${item.brand}.`],
        image: pages.image,
        imageLinks: [pages.image],
      },
      {
        url: pages.manual,
        title: `${item.name} user manual`,
        highlights: [`${item.name} user manual (PDF)`],
      },
    ],
    text: JSON.stringify(searchFindings(item)),
  });
}

function answerResearchRead(req: ParsedLanguageRequest): WireLanguageBody {
  const item = itemIn(promptText(req));
  return textResponse(JSON.stringify(item ? fetchDraft(item) : NOT_FOUND));
}

// ── Image ranking ────────────────────────────────────────────────────────

function answerImageRank(req: ParsedLanguageRequest): WireLanguageBody {
  const shown = Math.max(1, promptFiles(req, "image/").length);
  const order = Array.from({ length: shown }, (_, index) => index);
  const reasons = Array.from({ length: shown }, () => "The product on a plain background.");
  return textResponse(JSON.stringify({ order, reasons }));
}

// ── /v3/ai/language-model ───────────────────────────────────────────────

async function handleLanguageModel(rawReq: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = await readBody(rawReq);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    sendBadJson(res);
    return;
  }
  const req = parseLanguageRequest(rawReq.headers, body);

  if (req.streaming) {
    sendLanguageReply(res, true, answerChat(req));
    return;
  }
  if (req.tools.some((tool) => tool.name === EXA_SEARCH_TOOL_NAME)) {
    sendLanguageReply(res, false, answerResearchSearch(req));
    return;
  }
  if (promptHasImage(req)) {
    sendLanguageReply(res, false, answerImageRank(req));
    return;
  }
  sendLanguageReply(res, false, answerResearchRead(req));
}

// ── The pages research "found" ──────────────────────────────────────────

function productPage(item: IntakeFixtureItem): string {
  const image = pagesFor(item).image;
  return [
    "<!doctype html>",
    `<title>${item.name}</title>`,
    `<meta property="og:image" content="${image}">`,
    `<p>E2E stub product page for the ${item.name}.</p>`,
  ].join("\n");
}

// ── The server ───────────────────────────────────────────────────────────

const LANGUAGE_PATH = `/v3/ai${LANGUAGE_MODEL_PATH}`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", GATEWAY_STUB_ORIGIN);

  if (req.method === "POST" && url.pathname === LANGUAGE_PATH) {
    await handleLanguageModel(req, res);
    return;
  }

  if (url.pathname.startsWith("/manuals/")) {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end("%PDF-1.4\n% e2e stub manual\n");
    return;
  }
  if (url.pathname.startsWith("/products/")) {
    const slug = url.pathname.slice("/products/".length);
    const item = Object.values(INTAKE_ITEMS).find((candidate) => candidate.slug === slug);
    res.writeHead(200, { "content-type": "text/html" });
    res.end(item ? productPage(item) : "<!doctype html><title>Product</title><p>E2E stub product page.</p>");
    return;
  }
  if (url.pathname.startsWith("/img/")) {
    res.writeHead(200, { "content-type": "image/png" });
    res.end(Buffer.from(makeProductPng({ width: 800, height: 600 })));
    return;
  }

  // Playwright's readiness probe.
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("gateway stub");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(GATEWAY_STUB_PORT, () => {
  console.info(`[gateway-stub] listening on ${GATEWAY_STUB_ORIGIN}`);
});
