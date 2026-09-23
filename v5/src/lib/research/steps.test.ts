// @vitest-environment node
import { GatewayInternalServerError, GatewayModelNotFoundError, GatewayRateLimitError } from "@ai-sdk/gateway";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { FatalError, RetryableError } from "workflow";
import {
  recordedCalls,
  resetModelStubs,
  scriptedModel,
  setLanguageModel,
  textModel,
} from "../../../test/ai/models-stub";
import { server } from "../../../test/msw/server";
import { setResolvedAddresses } from "../../../test/web/resolver";
import {
  completeResearch,
  createPendingBatch,
  discardPendingTool,
  getPendingTool,
  markResearching,
  queueForResearch,
} from "../data/pending-tools";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { getDb, resetDbForTests } from "../db/client";
import { pendingTools } from "../db/schema/index";
import { RESEARCH_MAX_WEB_SEARCHES, RESEARCH_STEP_MAX_RETRIES } from "../intake/limits";
import { parseSearchFindings } from "./model-output";

/**
 * The research search and read steps called as plain functions (spec §10
 * "Workflow steps, called directly with the model stubbed"; gateway spec §10
 * "Research step with a mocked model"). Without the workflow compiler
 * `"use step"` is only a string, so these run in this process against the
 * seeded PGlite database. Models are stubbed at the registry with
 * `MockLanguageModelV3` — nothing here knows a provider — and every page read
 * and link check is answered by MSW, with the DNS stand-in resolving every
 * host to a public address unless a test says otherwise. No key, no network.
 */

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import {
  completeFocusedItem,
  finishBatch,
  markItemFailed,
  readAndVerifyItem,
  reportSearchOvershoot,
  searchItem,
} from "./steps";
import type { ResearchResult } from "./result";

const MANUAL_URL = "https://prusa.example/mk4s-manual.pdf";
const GONE_URL = "https://prusa.example/gone.pdf";
const PRODUCT_URL = "https://prusa.example/mk4s";
const OG_IMAGE = "https://prusa.example/img/mk4s-og.jpg";
const EXA_IMAGE = "https://cdn.prusa.example/mk4s-hero.webp";
const PRODUCT_TEXT = "The Original Prusa MK4S has a 250 × 210 × 220 mm build volume.";
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n% the MK4S manual\n");

const FINDINGS = {
  canonicalName: "Original Prusa MK4S",
  description: "An FDM 3D printer.",
  category: { name: "FDM", group: "3D Printing" },
  candidateLinks: [
    { title: "Product page", url: PRODUCT_URL, type: "Other" },
    { title: "MK4S manual", url: MANUAL_URL, type: "Manual" },
  ],
  sourceUrls: [PRODUCT_URL],
  evidence: { userStatedModel: true, manufacturerPageFound: true },
};

const DRAFT = {
  canonicalName: "Original Prusa MK4S",
  description: "An FDM 3D printer with a 250 × 210 × 220 mm build volume.",
  specs: [{ label: "Build volume", value: "250 × 210 × 220 mm" }],
  materials: ["PLA", "PETG"],
  ppeRequired: [],
  tags: ["FDM"],
  trainingRequired: true,
  useRestrictions: null,
  category: { name: "FDM", group: "3D Printing" },
  resources: [
    { title: "MK4S manual", url: MANUAL_URL, type: "Manual" },
    { title: "Old manual", url: GONE_URL, type: "Manual" },
  ],
  // A page the model claims but was never given: provenance comes from what was read.
  sourceUrls: [PRODUCT_URL, "https://prusa.example/never-read"],
  evidence: {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: true,
    manualFound: true,
    specsFromSource: true,
    categoryOnly: false,
  },
};

const EXA_RESULTS = [
  {
    id: PRODUCT_URL,
    title: "Original Prusa MK4S",
    url: PRODUCT_URL,
    highlights: ["The MK4S…"],
    image: EXA_IMAGE,
    extras: { imageLinks: [OG_IMAGE, "https://cdn.prusa.example/side.png"] },
  },
];

/**
 * The search model: one provider-executed `exa_search` (call and result in the
 * same response, as the Gateway returns them) and then its answer.
 */
function searchModel(answer: unknown) {
  return scriptedModel(() => ({
    content: [
      {
        type: "tool-call",
        toolCallId: "exa_1",
        toolName: "exa_search",
        input: JSON.stringify({ query: "Prusa MK4S" }),
        providerExecuted: true,
      },
      {
        type: "tool-result",
        toolCallId: "exa_1",
        toolName: "exa_search",
        result: { requestId: "exa_req", results: EXA_RESULTS, costDollars: { total: 0.007 } },
      },
      { type: "text", text: typeof answer === "string" ? answer : JSON.stringify(answer) },
    ],
    finishReason: "stop",
  }));
}

/** Stub both research jobs: the search answers `search`, the read answers `read`. */
function answer(search: unknown, read: unknown = DRAFT) {
  const models = {
    search: searchModel(search),
    read: textModel(typeof read === "string" ? read : JSON.stringify(read)),
  };
  setLanguageModel("researchSearch", models.search);
  setLanguageModel("researchRead", models.read);
  return models;
}

/** A model whose call `n` throws `errors[n]` when there is one, and otherwise answers `text`. */
function failingModel(errors: unknown[], text: string) {
  return scriptedModel((n) => {
    if (n < errors.length) throw errors[n];
    return { content: [{ type: "text", text }], finishReason: "stop" };
  });
}

/** Every text part of a recorded prompt, joined. */
function promptText(call: ReturnType<typeof recordedCalls>[number]): string {
  return call.prompt
    .flatMap((message) =>
      typeof message.content === "string"
        ? [message.content]
        : message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
    )
    .join("\n");
}

function fileParts(call: ReturnType<typeof recordedCalls>[number]) {
  return call.prompt.flatMap((message) =>
    typeof message.content === "string" ? [] : message.content.filter((part) => part.type === "file")
  );
}

let counter = 0;

/** The request every item here is queued under, as the route stamps it. */
const REQUEST = crypto.randomUUID();

/** A fresh pending item, queued the way the route leaves it. */
async function queuedItem(name = `Research test item ${++counter}`): Promise<string> {
  const { items } = await createPendingBatch({
    createdBy: DEMO_ACCOUNTS.admin.id,
    items: [{ name: `${name} ${crypto.randomUUID().slice(0, 8)}`, brand: "Prusa" }],
  });
  const [id] = items.map((item) => item.id);
  expect(await queueForResearch([id], { requestedBy: DEMO_ACCOUNTS.admin.id, requestId: REQUEST })).toEqual([id]);
  return id;
}

async function statusOf(id: string) {
  return (await getPendingTool(id))?.status;
}

/** Search for `id` and return its findings, failing the test on a skip. */
async function searched(id: string) {
  const search = await searchItem(id, REQUEST);
  if (search.skip) throw new Error("expected findings");
  return search;
}

const pageHits: string[] = [];

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  resetModelStubs();
  pageHits.length = 0;
  server.use(
    http.get(PRODUCT_URL, () => {
      pageHits.push(PRODUCT_URL);
      return HttpResponse.html(
        `<html><head><title>Original Prusa MK4S</title><meta property="og:image" content="/img/mk4s-og.jpg"></head>` +
          `<body><nav>Shop</nav><main><h1>MK4S</h1><p>${PRODUCT_TEXT}</p></main></body></html>`
      );
    }),
    http.get(MANUAL_URL, () => {
      pageHits.push(MANUAL_URL);
      return HttpResponse.arrayBuffer(PDF_BYTES.slice().buffer, { headers: { "content-type": "application/pdf" } });
    }),
    http.get(GONE_URL, () => new HttpResponse(null, { status: 404 }))
  );
  await getDb();
});

afterEach(() => {
  resetModelStubs();
});

afterAll(() => {
  resetDbForTests();
});

describe("searchItem + readAndVerifyItem", () => {
  it("researches an item and returns the result, verified and graded in code, without writing it", async () => {
    const id = await queuedItem();
    answer(FINDINGS);

    const search = await searched(id);
    expect(await statusOf(id)).toBe("researching");
    expect(search.findings.canonicalName).toBe("Original Prusa MK4S");

    const read = await readAndVerifyItem(id, REQUEST, search.findings);
    if (read.outcome !== "drafted") throw new Error("expected a draft");
    const { result } = read;
    expect(result.resources).toEqual([{ title: "MK4S manual", url: MANUAL_URL, type: "Manual" }]);
    expect(result.droppedLinks).toEqual([`Manual "Old manual" (${GONE_URL}) — HTTP 404`]);
    expect(result.confidence.level).toBe("high");
    expect(result.canonicalName).toBe("Original Prusa MK4S");
    // The pages that were read, not the ones the model claimed.
    expect(result.sourceUrls).toEqual([PRODUCT_URL, MANUAL_URL]);

    // The image stage writes the row; this step leaves it as it found it.
    const item = await getPendingTool(id);
    expect(item?.status).toBe("researching");
    expect(item?.research).toBeNull();
    expect(item?.researchError).toBeNull();
  });

  it("gives the search exa_search and nothing else, its own deadline and no retry loop of its own", async () => {
    const id = await queuedItem();
    const models = answer(FINDINGS);
    await searched(id);

    const [call] = recordedCalls(models.search);
    expect(call.tools).toEqual([
      {
        type: "provider",
        id: "gateway.exa_search",
        name: "exa_search",
        args: { numResults: 6, contents: { text: { maxCharacters: 12000 }, highlights: true, extras: { imageLinks: 3 } } },
      },
    ]);
    expect(call.options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call.options.abortSignal?.aborted).toBe(false);
    expect(promptText(call)).toContain("`exa_search` tool **at most 4 times**");
    expect(call.providerOptions).toBeUndefined();
  });

  it("hands on the images Exa reported, attributed to their pages", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    const search = await searched(id);
    expect(search.exaImages).toEqual([
      { url: EXA_IMAGE, source: "exa", pageUrl: PRODUCT_URL },
      { url: OG_IMAGE, source: "exa", pageUrl: PRODUCT_URL },
      { url: "https://cdn.prusa.example/side.png", source: "exa", pageUrl: PRODUCT_URL },
    ]);
  });

  it("cannot stop a search that overshoots its budget inside one Gateway call — it logs it", async () => {
    // Six searches the Gateway ran before its one response came back. With only
    // a provider-executed tool, generateText makes exactly one request, so there
    // is no later step at which the tool could have been withdrawn.
    const searches = Array.from({ length: 6 }, (_, i) => [
      {
        type: "tool-call" as const,
        toolCallId: `exa_${i}`,
        toolName: "exa_search",
        input: JSON.stringify({ query: `Prusa MK4S ${i}` }),
        providerExecuted: true,
      },
      {
        type: "tool-result" as const,
        toolCallId: `exa_${i}`,
        toolName: "exa_search",
        result: { requestId: `exa_req_${i}`, results: EXA_RESULTS },
      },
    ]).flat();
    const search = scriptedModel(() => ({
      content: [...searches, { type: "text", text: JSON.stringify(FINDINGS) }],
      finishReason: "stop",
    }));
    setLanguageModel("researchSearch", search);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = await queuedItem();

    const result = await searched(id);

    expect(recordedCalls(search)).toHaveLength(1);
    expect(result.findings.canonicalName).toBe("Original Prusa MK4S");
    expect(RESEARCH_MAX_WEB_SEARCHES).toBe(4);
    const logged = warn.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain(`[research] ${REQUEST}: the search ran exa_search 6 times, over its budget of 4`);
    // Counts and the request id only — never the item.
    expect(logged).not.toContain("Research test item");
  });

  it("logs nothing when the search stays within its budget", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(reportSearchOvershoot(REQUEST, [{ toolCalls: Array.from({ length: 4 }, () => ({ toolName: "exa_search" })) }])).toBe(4);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads the pages itself and gives the read model no tools: fenced page text, labelled, and the PDF as a file", async () => {
    const id = await queuedItem();
    const models = answer(FINDINGS);
    const search = await searched(id);
    await readAndVerifyItem(id, REQUEST, search.findings);

    expect(pageHits).toEqual(expect.arrayContaining([PRODUCT_URL, MANUAL_URL]));
    const calls = recordedCalls(models.read);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.tools ?? []).toEqual([]);
    expect(call.providerOptions).toBeUndefined();
    expect(call.options.abortSignal).toBeInstanceOf(AbortSignal);

    const text = promptText(call);
    expect(text).toContain("You have no tools and cannot open anything else");
    expect(text).toMatch(new RegExp(`<untrusted-page id="[0-9a-f]+" source="${PRODUCT_URL}">[\\s\\S]*${PRODUCT_TEXT}`));
    expect(text).toContain(`1. ${MANUAL_URL}`);
    expect(text).toMatch(/- Name: Research test item/);

    const files = fileParts(call);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ type: "file", mediaType: "application/pdf" });
    expect(Buffer.from(files[0].data as Uint8Array).toString()).toBe(Buffer.from(PDF_BYTES).toString());
  });

  it("returns the product images the pages declared", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    const search = await searched(id);
    const read = await readAndVerifyItem(id, REQUEST, search.findings);
    expect(read).toMatchObject({
      outcome: "drafted",
      imageHints: [{ url: OG_IMAGE, source: "og", pageUrl: PRODUCT_URL }],
    });
  });

  it("never fetches a candidate whose host resolves to a private address", async () => {
    const INTERNAL = "https://intranet.prusa.example/admin";
    let internalHit = false;
    setResolvedAddresses({ "intranet.prusa.example": ["10.0.0.7"] });
    server.use(
      http.get(INTERNAL, () => {
        internalHit = true;
        return HttpResponse.text("internal");
      })
    );
    const id = await queuedItem();
    const models = answer({
      ...FINDINGS,
      candidateLinks: [{ title: "Admin", url: INTERNAL, type: "Other" }, ...FINDINGS.candidateLinks],
    });
    const search = await searched(id);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const read = await readAndVerifyItem(id, REQUEST, search.findings);
    expect(read.outcome).toBe("drafted");
    expect(internalHit).toBe(false);
    expect(promptText(recordedCalls(models.read)[0])).toContain("- intranet.prusa.example: blocked (forbidden_address)");
    // Logged by host, never by path.
    const logged = info.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain("intranet.prusa.example: blocked");
    expect(logged).not.toContain("/admin");
  });

  it("ignores a confidence the model claims and recomputes the grade", async () => {
    const id = await queuedItem();
    answer(
      { ...FINDINGS, confidence: { level: "high" } },
      {
        ...DRAFT,
        confidence: { level: "high", basis: ["The page says so"], unknowns: [] },
        evidence: { categoryOnly: true },
      }
    );

    const search = await searched(id);
    const read = await readAndVerifyItem(id, REQUEST, search.findings);
    if (read.outcome !== "drafted") throw new Error("expected a draft");
    expect(read.result.confidence.level).toBe("low");
    expect(read.result.confidence.basis).not.toContain("The page says so");
  });

  it("throws RetryableError when the Gateway rate limits the search, and the retry resumes the row", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    setLanguageModel(
      "researchSearch",
      failingModel([new GatewayRateLimitError({ message: "slow down", statusCode: 429 })], JSON.stringify(FINDINGS))
    );

    const error = await searchItem(id, REQUEST).catch((e: unknown) => e);
    expect(RetryableError.is(error)).toBe(true);
    expect((error as Error).message).toContain("rate limiting");
    expect(await statusOf(id)).toBe("researching");

    // The retry finds the row its own first attempt claimed, and carries on.
    const retried = await searchItem(id, REQUEST);
    expect(retried.skip).toBe(false);
    expect(await statusOf(id)).toBe("researching");
  });

  it("throws RetryableError on a 5xx from the read model too, and the row still resumes", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    const search = await searched(id);
    setLanguageModel(
      "researchRead",
      failingModel([new GatewayInternalServerError({ message: "upstream failed", statusCode: 502 })], JSON.stringify(DRAFT))
    );

    const error = await readAndVerifyItem(id, REQUEST, search.findings).catch((e: unknown) => e);
    expect(RetryableError.is(error)).toBe(true);
    expect((error as Error).message).toContain("Research (reading pages)");
    expect(await statusOf(id)).toBe("researching");

    expect((await readAndVerifyItem(id, REQUEST, search.findings)).outcome).toBe("drafted");
  });

  it("gives up, naming MODEL_RESEARCH_READ, when the Gateway does not know the read model", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    const search = await searched(id);
    setLanguageModel(
      "researchRead",
      failingModel([new GatewayModelNotFoundError({ message: "Model 'openai/gpt-nope' not found", statusCode: 404 })], "{}")
    );

    const error = await readAndVerifyItem(id, REQUEST, search.findings).catch((e: unknown) => e);
    expect(FatalError.is(error)).toBe(true);
    expect((error as Error).message).toBe("Research (reading pages): model not available (MODEL_RESEARCH_READ).");
  });

  it("gives up on a malformed MODEL_RESEARCH_SEARCH, naming the variable and never its value", async () => {
    vi.stubEnv("MODEL_RESEARCH_SEARCH", "Not A Model sk-secret-looking-value");
    const id = await queuedItem();
    answer(FINDINGS);

    const error = await searchItem(id, REQUEST).catch((e: unknown) => e);
    expect(FatalError.is(error)).toBe(true);
    expect((error as Error).message).toBe("Research (search): model not available (MODEL_RESEARCH_SEARCH).");
    expect((error as Error).message).not.toContain("Not A Model");
  });

  it("throws FatalError on an answer that is not JSON", async () => {
    const id = await queuedItem();
    answer("I looked around but I'd rather describe it in prose.");
    const error = await searchItem(id, REQUEST).catch((e: unknown) => e);
    expect(FatalError.is(error)).toBe(true);
    expect((error as Error).message).toContain("no JSON object");

    // The claim happened before the model call, so the row is researching and
    // the read pass runs — and its bad answer is fatal too.
    answer(FINDINGS, "not json either");
    const readError = await readAndVerifyItem(id, REQUEST, parseSearchFindings(JSON.stringify(FINDINGS))).catch(
      (e: unknown) => e
    );
    expect(FatalError.is(readError)).toBe(true);
  });

  it("stops without writing when the item was discarded before the step ran", async () => {
    const id = await queuedItem();
    const discarded = await discardPendingTool(id);
    expect(discarded.ok).toBe(true);
    const models = answer(FINDINGS);

    expect(await searchItem(id, REQUEST)).toEqual({ skip: true });
    expect(recordedCalls(models.search)).toHaveLength(0);
    const item = await getPendingTool(id);
    expect(item?.status).toBe("discarded");
    expect(item?.research).toBeNull();

    // A read pass for a row that is not researching reads nothing and writes nothing either.
    expect(await readAndVerifyItem(id, REQUEST, parseSearchFindings(JSON.stringify(FINDINGS)))).toEqual({
      outcome: "skipped",
    });
    expect(pageHits).toEqual([]);
    expect(recordedCalls(models.read)).toHaveLength(0);
    expect(await statusOf(id)).toBe("discarded");
  });

  it("stops without writing when a later press took the item over", async () => {
    const id = await queuedItem();
    // This run's start looked failed; the person pressed Retry and a second
    // request now holds the row.
    const db = await getDb();
    await db
      .update(pendingTools)
      .set({ researchRequestId: crypto.randomUUID() })
      .where(eq(pendingTools.id, id));
    const models = answer(FINDINGS);

    expect(await searchItem(id, REQUEST)).toEqual({ skip: true });
    expect(recordedCalls(models.search)).toHaveLength(0);
    expect(await statusOf(id)).toBe("queued");
    expect(await markItemFailed(id, REQUEST, "not mine")).toBe(false);
  });

  it("does not carry on with a row another run is researching", async () => {
    const id = await queuedItem();
    const models = answer(FINDINGS);
    const other = crypto.randomUUID();
    const db = await getDb();
    await db
      .update(pendingTools)
      .set({ status: "researching", researchRequestId: other })
      .where(eq(pendingTools.id, id));

    expect(await searchItem(id, REQUEST)).toEqual({ skip: true });
    expect(await readAndVerifyItem(id, REQUEST, parseSearchFindings(JSON.stringify(FINDINGS)))).toEqual({
      outcome: "skipped",
    });
    expect(recordedCalls(models.search)).toHaveLength(0);
    expect(recordedCalls(models.read)).toHaveLength(0);
  });

  it("drafts 'found nothing' with low confidence and no links — never failed, never invented", async () => {
    const id = await queuedItem("Unknown vinyl cutter");
    const models = answer({ canonicalName: "", evidence: { userStatedModel: true } });

    const search = await searched(id);
    const read = await readAndVerifyItem(id, REQUEST, search.findings);
    if (read.outcome !== "drafted") throw new Error("expected a draft");

    // Nothing to read, so no page was fetched and no read pass was spent.
    expect(pageHits).toEqual([]);
    expect(recordedCalls(models.read)).toHaveLength(0);
    const item = await getPendingTool(id);
    expect(read.result.confidence.level).toBe("low");
    expect(read.result.resources).toEqual([]);
    expect(read.result.sourceUrls).toEqual([]);
    expect(read.result.specs).toEqual([]);
    expect(read.result.canonicalName).toBe(item?.name);
    expect(read.imageHints).toEqual([]);
    expect(item?.status).toBe("researching");
  });

  it("keeps the search's links, verified, when none of its pages could be read — and spends no read pass", async () => {
    server.use(
      http.get(PRODUCT_URL, () => new HttpResponse("Forbidden", { status: 403 })),
      http.get(MANUAL_URL, () => new HttpResponse("Forbidden", { status: 403 }))
    );
    vi.spyOn(console, "info").mockImplementation(() => {});
    const id = await queuedItem();
    const models = answer(FINDINGS);

    const search = await searched(id);
    const read = await readAndVerifyItem(id, REQUEST, search.findings);
    if (read.outcome !== "drafted") throw new Error("expected a draft");

    expect(recordedCalls(models.read)).toHaveLength(0);
    expect(read.result.sourceUrls).toEqual([]);
    // A 403 is not a definitive "not found", so link verification keeps both.
    expect(read.result.resources.map((link) => link.url)).toEqual([PRODUCT_URL, MANUAL_URL]);
    expect(read.result.evidence.manufacturerPageFound).toBe(false);
    expect(read.result.confidence.level).not.toBe("high");
  });

  it("carries the search's page text to the read step, and reads a refused product page from it, labelled (amendment \"Search text fallback\")", async () => {
    // The product page answers our reader with a bot challenge; Exa read it.
    server.use(http.get(PRODUCT_URL, () => new HttpResponse("Just a moment…", { status: 403 })));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const copy = `${PRODUCT_TEXT} Nozzle 0.4 mm, heated bed 120 °C. `.repeat(5);
    const search = scriptedModel(() => ({
      content: [
        { type: "tool-call", toolCallId: "exa_1", toolName: "exa_search", input: "{}", providerExecuted: true },
        {
          type: "tool-result",
          toolCallId: "exa_1",
          toolName: "exa_search",
          result: {
            requestId: "exa_req",
            results: [
              { ...EXA_RESULTS[0], text: copy },
              // A page nobody will read: its text does not cross the step boundary.
              { id: "https://elsewhere.example/", url: "https://elsewhere.example/", title: "Elsewhere", text: copy },
            ],
          },
        },
        { type: "text", text: JSON.stringify(FINDINGS) },
      ],
      finishReason: "stop",
    }));
    const read = textModel(JSON.stringify(DRAFT));
    setLanguageModel("researchSearch", search);
    setLanguageModel("researchRead", read);
    const id = await queuedItem();

    const found = await searched(id);
    expect(found.searchTexts).toEqual([{ url: PRODUCT_URL, title: "Original Prusa MK4S", text: copy.trim() }]);

    const step = await readAndVerifyItem(id, REQUEST, found.findings, null, found.searchTexts);
    if (step.outcome !== "drafted") throw new Error("expected a draft");

    const text = promptText(recordedCalls(read)[0]);
    expect(text).toMatch(
      new RegExp(`<untrusted-page id="[0-9a-f]+" source="${PRODUCT_URL} \\(text captured by search\\)">[\\s\\S]*Nozzle 0\\.4 mm`)
    );
    expect(text).not.toContain("prusa.example: failed (http_403)");
    // It counts: the brand's own product page, so manufacturer page and specs hold.
    expect(step.result.sourceUrls).toEqual([PRODUCT_URL, MANUAL_URL]);
    expect(step.result.searchTextSources).toEqual([PRODUCT_URL]);
    expect(step.result.evidence).toMatchObject({ manufacturerPageFound: true, specsFromSource: true });
    expect(step.result.confidence.level).toBe("high");
    const logged = info.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).toContain("1 from the search's text");
  });

  it("does not use the search's text when the page reads, and reads nothing new without it", async () => {
    const id = await queuedItem();
    const models = answer(FINDINGS);
    const found = await searched(id);
    // EXA_RESULTS carry highlights only, so there is no text to carry.
    expect(found.searchTexts).toEqual([]);
    const withCopy = [{ url: PRODUCT_URL, title: "copy", text: "A copy that must not be used. ".repeat(10) }];

    const step = await readAndVerifyItem(id, REQUEST, found.findings, null, withCopy);
    if (step.outcome !== "drafted") throw new Error("expected a draft");
    const text = promptText(recordedCalls(models.read)[0]);
    expect(text).toContain(PRODUCT_TEXT);
    expect(text).not.toContain("A copy that must not be used.");
    expect(text).not.toContain("text captured by search)");
    expect("searchTextSources" in step.result).toBe(false);
  });

  it("sets maxRetries as a property on each model step", () => {
    expect((searchItem as unknown as { maxRetries: number }).maxRetries).toBe(RESEARCH_STEP_MAX_RETRIES);
    expect((readAndVerifyItem as unknown as { maxRetries: number }).maxRetries).toBe(RESEARCH_STEP_MAX_RETRIES);
  });
});

describe("markItemFailed / finishBatch", () => {
  it("fails the item with the reason, scrubbed", async () => {
    const id = await queuedItem();
    expect(await markItemFailed(id, REQUEST, "Research (search): refused (HTTP 401): bad key sk-ant-abcdefghijk")).toBe(true);
    const item = await getPendingTool(id);
    expect(item?.status).toBe("failed");
    expect(item?.researchError).toBe("Research (search): refused (HTTP 401): bad key [redacted]");
  });

  it("logs one line of counts and nothing about the items", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await finishBatch("request-1", { researched: 2, failed: 1, skipped: 0 });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toBe("[research] batch request-1 finished: researched=2 failed=1 skipped=0");
  });
});

describe('a guided redo, search to write (amendment "Guided redo (focus + guidance)")', () => {
  const STORED: ResearchResult = {
    canonicalName: "Original Prusa MK4S",
    description: "The old description, kept.",
    specs: [{ label: "Old spec", value: "1" }],
    materials: ["PLA"],
    ppeRequired: [],
    tags: ["old-tag"],
    trainingRequired: false,
    useRestrictions: "Old restriction",
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [],
    droppedLinks: [],
    sourceUrls: [],
    evidence: {
      userStatedModel: false,
      modelPlateRead: null,
      manufacturerPageFound: false,
      manualFound: false,
      specsFromSource: false,
      categoryOnly: true,
    },
    confidence: { level: "low", basis: [], unknowns: [] },
    images: {
      candidates: [
        {
          url: "https://prusa.example/img/old.jpg",
          pageUrl: PRODUCT_URL,
          source: "og",
          width: 1000,
          height: 1000,
          contentType: "image/jpeg",
          rank: 1,
          reason: "front",
        },
      ],
      cleaned: null,
    },
    imageError: null,
  };

  /** An item researched once (STORED), queued again under `requestId` as the route leaves a Research again. */
  async function researchedThenQueued(requestId: string): Promise<string> {
    const first = crypto.randomUUID();
    const { items } = await createPendingBatch({
      createdBy: DEMO_ACCOUNTS.admin.id,
      items: [{ name: `Redo item ${crypto.randomUUID().slice(0, 8)}`, brand: "Prusa" }],
    });
    const id = items[0].id;
    await queueForResearch([id], { requestedBy: DEMO_ACCOUNTS.admin.id, requestId: first });
    await markResearching(id, { requestId: first });
    expect(await completeResearch(id, STORED, { requestId: first })).toBe(true);
    expect(await queueForResearch([id], { requestedBy: DEMO_ACCOUNTS.admin.id, requestId })).toEqual([id]);
    return id;
  }

  it("tells both passes the focus and the note, fenced, and writes only the specs", async () => {
    const models = answer(FINDINGS);
    const requestId = crypto.randomUUID();
    const id = await researchedThenQueued(requestId);
    const before = (await getPendingTool(id))?.research;

    const search = await searchItem(id, requestId, "use the spec table", ["specs"]);
    if (search.skip) throw new Error("expected findings");
    const read = await readAndVerifyItem(id, requestId, search.findings, "use the spec table", search.searchTexts ?? [], [
      "specs",
    ]);
    if (read.outcome !== "drafted") throw new Error("expected a draft");

    for (const model of [models.search, models.read]) {
      const text = promptText(recordedCalls(model)[0]);
      expect(text).toContain("<reviewer-focus>\nThe reviewer wants you to focus on: the specs\n</reviewer-focus>");
      expect(text).toContain("<reviewer-instruction>\nuse the spec table\n</reviewer-instruction>");
    }

    expect(await completeFocusedItem(id, requestId, read.result, ["specs"])).toMatchObject({ outcome: "researched" });
    const after = (await getPendingTool(id))?.research;
    expect(after?.specs).toEqual(DRAFT.specs);
    expect(after?.evidence.specsFromSource).toBe(true);
    // Everything the focus did not name is exactly as it was stored.
    for (const key of ["description", "materials", "tags", "trainingRequired", "useRestrictions", "category", "images", "resources"] as const) {
      expect(JSON.stringify(after?.[key])).toBe(JSON.stringify(before?.[key]));
    }
    expect(after?.researchFocus).toEqual(["specs"]);
    expect(after?.reviewerNote).toBe("use the spec table");
    expect(await statusOf(id)).toBe("researched");
  });

  it("writes nothing for a run that is no longer the row's", async () => {
    answer(FINDINGS);
    const requestId = crypto.randomUUID();
    const id = await researchedThenQueued(requestId);
    const search = await searchItem(id, requestId, null, ["description"]);
    if (search.skip) throw new Error("expected findings");
    const read = await readAndVerifyItem(id, requestId, search.findings, null, [], ["description"]);
    if (read.outcome !== "drafted") throw new Error("expected a draft");
    expect(await completeFocusedItem(id, crypto.randomUUID(), read.result, ["description"])).toEqual({ outcome: "skipped" });
    expect((await getPendingTool(id))?.research?.description).toBe("The old description, kept.");
  });
});
