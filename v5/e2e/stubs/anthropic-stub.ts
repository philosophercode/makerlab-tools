import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  AFTER_TABLE_REPLY,
  ASK_FOR_ITEMS_REPLY,
  GATEWAY_STUB_ORIGIN as ANTHROPIC_STUB_ORIGIN,
  GATEWAY_STUB_PORT as ANTHROPIC_STUB_PORT,
  INTAKE_ITEMS,
  type IntakeFixtureItem,
} from "./intake-fixture.ts";

// NOTE (gateway migration): this file is retired and unused — nothing in
// playwright.config.ts references it any more (see gateway-stub.ts, which
// replaces it). It is kept only because deleting it needs separate approval
// (see proposedDeletions in the migration's report); `intake-fixture.ts`'s
// ANTHROPIC_STUB_* names were renamed to GATEWAY_STUB_* for the file that
// actually runs, so the aliases above are only to keep this dead file
// type-checking until it is deleted.

/**
 * A stand-in for the Anthropic Messages API, for the intake E2E only (data
 * platform spec §10, E2E scenario 5).
 *
 * Every other spec intercepts `/api/chat` in the browser, which cannot reach
 * what scenario 5 needs: `identify_tools` writing real pending rows, and the
 * research workflow's steps running server-side minutes after the click. So
 * the Playwright server boots with `ANTHROPIC_BASE_URL` pointing here and a
 * fake key, and the model is stubbed **at the provider boundary** — the same
 * seam the `@workflow/vitest` test stubs with MSW. Everything between the
 * browser and this process is the real app: the chat route, the capability,
 * the routes, the workflow on the local world, link verification.
 *
 * It answers three kinds of request, told apart by what the app sends:
 *
 * - **the chat** (`stream: true`): the header's Add seed gets a question, the
 *   next message gets one `identify_tools` call, and the turn after the tool
 *   result gets one line of text;
 * - **research, search step** (a `web_search` tool, no stream): findings that
 *   point at a product page and a manual on this server;
 * - **research, fetch step** (a `web_fetch` tool): a full draft.
 *
 * It also serves those pages, so link verification opens real URLs and finds
 * them — no request leaves the machine.
 */

interface AnthropicRequest {
  stream?: boolean;
  messages?: { role: string; content: unknown }[];
  tools?: { name?: string; type?: string }[];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function blocks(content: unknown): { type?: string; text?: string }[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? (content as { type?: string; text?: string }[]) : [];
}

const USAGE = { input_tokens: 1, output_tokens: 1 };

// ── The chat ────────────────────────────────────────────────────────────────

function sse(res: ServerResponse, events: Record<string, unknown>[]): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  for (const event of events) {
    res.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  }
  res.end();
}

function streamed(block: Record<string, unknown>, delta: Record<string, unknown>, stopReason: string) {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_e2e",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: USAGE,
      },
    },
    { type: "content_block_start", index: 0, content_block: block },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: USAGE },
    { type: "message_stop" },
  ];
}

function textEvents(text: string) {
  return streamed({ type: "text", text: "" }, { type: "text_delta", text }, "end_turn");
}

function identifyEvents() {
  const input = {
    items: Object.values(INTAKE_ITEMS).map((item) => ({
      name: item.identifiedAs,
      brand: item.brand,
      categoryHint: item.categoryHint,
      attachmentIds: [],
    })),
  };
  return streamed(
    { type: "tool_use", id: "toolu_e2e_identify", name: "identify_tools", input: {} },
    { type: "input_json_delta", partial_json: JSON.stringify(input) },
    "tool_use"
  );
}

function answerChat(res: ServerResponse, body: AnthropicRequest): void {
  const last = body.messages?.at(-1);
  const content = blocks(last?.content);
  if (content.some((block) => block.type === "tool_result")) {
    sse(res, textEvents(AFTER_TABLE_REPLY));
    return;
  }
  const said = content.map((block) => block.text ?? "").join(" ");
  sse(res, /add new equipment/i.test(said) ? textEvents(ASK_FOR_ITEMS_REPLY) : identifyEvents());
}

// ── Research ────────────────────────────────────────────────────────────────

/** Which fixture item a research prompt is about — by the name it carries. */
function itemIn(raw: string): IntakeFixtureItem | null {
  for (const item of Object.values(INTAKE_ITEMS)) {
    if (raw.includes(item.name) || raw.includes(item.identifiedAs)) return item;
  }
  return null;
}

function pagesFor(item: IntakeFixtureItem) {
  return {
    product: `${ANTHROPIC_STUB_ORIGIN}/products/${item.slug}`,
    manual: `${ANTHROPIC_STUB_ORIGIN}/manuals/${item.slug}.pdf`,
  };
}

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

function answerResearch(res: ServerResponse, body: AnthropicRequest, raw: string): void {
  const item = itemIn(raw);
  const toolNames = (body.tools ?? []).map((tool) => tool.name);
  // Research that recognises nothing finds nothing, which grades low — never
  // an invented page (§5.4).
  const answer = !item
    ? { canonicalName: "", description: "", candidateLinks: [], sourceUrls: [] }
    : toolNames.includes("web_fetch")
      ? fetchDraft(item)
      : searchFindings(item);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      id: "msg_e2e_research",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: JSON.stringify(answer) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: USAGE,
    })
  );
}

// ── The server ──────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ANTHROPIC_STUB_ORIGIN);

  if (req.method === "POST" && url.pathname === "/v1/messages") {
    const raw = await readBody(req);
    let body: AnthropicRequest;
    try {
      body = JSON.parse(raw) as AnthropicRequest;
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "not JSON" } }));
      return;
    }
    if (body.stream) answerChat(res, body);
    else answerResearch(res, body, raw);
    return;
  }

  // The pages research "found": link verification opens these.
  if (url.pathname.startsWith("/manuals/")) {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end("%PDF-1.4\n% e2e stub manual\n");
    return;
  }
  if (url.pathname.startsWith("/products/")) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>Product</title><p>E2E stub product page.</p>");
    return;
  }

  // Playwright's readiness probe.
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("anthropic stub");
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(ANTHROPIC_STUB_PORT, () => {
  console.info(`[anthropic-stub] listening on ${ANTHROPIC_STUB_ORIGIN}`);
});
