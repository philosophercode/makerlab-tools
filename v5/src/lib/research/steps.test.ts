// @vitest-environment node
import { APICallError } from "ai";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { FatalError, RetryableError } from "workflow";
import { server } from "../../../test/msw/server";
import {
  createPendingBatch,
  discardPendingTool,
  getPendingTool,
  queueForResearch,
} from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { pendingTools } from "../db/schema/index";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { RESEARCH_STEP_MAX_RETRIES } from "../intake/limits";
import { parseSearchFindings } from "./model-output";

/**
 * The research steps called as plain functions (spec §10 "Workflow steps,
 * called directly with the model stubbed"). Without the workflow compiler
 * `"use step"` is only a string, so these run in this process against the
 * seeded PGlite database, with `generateText` mocked and every link check
 * answered by MSW — no key, no network.
 */

const ai = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: ai.generateText };
});

import { fetchAndVerifyItem, finishBatch, markItemFailed, searchItem } from "./steps";

const MANUAL_URL = "https://prusa.example/mk4s-manual.pdf";
const GONE_URL = "https://prusa.example/gone.pdf";
const PRODUCT_URL = "https://prusa.example/mk4s";

const FINDINGS = {
  canonicalName: "Original Prusa MK4S",
  description: "An FDM 3D printer.",
  category: { name: "FDM", group: "3D Printing" },
  candidateLinks: [
    { title: "MK4S manual", url: MANUAL_URL, type: "Manual" },
    { title: "Product page", url: PRODUCT_URL, type: "Other" },
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
  sourceUrls: [PRODUCT_URL, MANUAL_URL],
  evidence: {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: true,
    manualFound: true,
    specsFromSource: true,
    categoryOnly: false,
  },
};

type GenerateArgs = {
  tools: Record<string, { args: Record<string, unknown> }>;
  abortSignal?: AbortSignal;
  maxRetries?: number;
  system: string;
  prompt: string;
};

/** Answer the search call with `search` and the fetch call with `fetch`. */
function answer(search: unknown, fetch: unknown = DRAFT) {
  ai.generateText.mockImplementation(async (args: GenerateArgs) => {
    const body = "web_search" in args.tools ? search : fetch;
    return { text: typeof body === "string" ? body : JSON.stringify(body) };
  });
}

function calls(): GenerateArgs[] {
  return ai.generateText.mock.calls.map(([args]) => args as GenerateArgs);
}

function apiError(statusCode: number) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode,
  });
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

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  ai.generateText.mockReset();
  server.use(
    http.get(MANUAL_URL, () => new HttpResponse("%PDF", { status: 200 })),
    http.get(PRODUCT_URL, () => new HttpResponse("<html></html>", { status: 200 })),
    http.get(GONE_URL, () => new HttpResponse(null, { status: 404 }))
  );
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("searchItem + fetchAndVerifyItem", () => {
  it("researches an item: verified links kept, dead ones dropped with a reason, graded in code", async () => {
    const id = await queuedItem();
    answer(FINDINGS);

    const search = await searchItem(id, REQUEST);
    expect(search.skip).toBe(false);
    expect(await statusOf(id)).toBe("researching");
    if (search.skip) return;

    const fetched = await fetchAndVerifyItem(id, REQUEST, search.findings);
    expect(fetched).toEqual({ outcome: "researched", confidence: "high" });

    const item = await getPendingTool(id);
    expect(item?.status).toBe("researched");
    expect(item?.researchError).toBeNull();
    expect(item?.research?.resources).toEqual([{ title: "MK4S manual", url: MANUAL_URL, type: "Manual" }]);
    expect(item?.research?.droppedLinks).toEqual([`Manual "Old manual" (${GONE_URL}) — HTTP 404`]);
    expect(item?.research?.confidence.level).toBe("high");
    expect(item?.research?.canonicalName).toBe("Original Prusa MK4S");
  });

  it("gives each call its own step deadline, the tool it needs and its limit, and no retry loop of its own", async () => {
    const id = await queuedItem();
    answer(FINDINGS);

    const search = await searchItem(id, REQUEST);
    if (search.skip) throw new Error("expected findings");
    await fetchAndVerifyItem(id, REQUEST, search.findings);

    const [searchCall, fetchCall] = calls();
    expect(searchCall.abortSignal).toBeInstanceOf(AbortSignal);
    expect(fetchCall.abortSignal).toBeInstanceOf(AbortSignal);
    expect(searchCall.abortSignal?.aborted).toBe(false);
    expect(searchCall.maxRetries).toBe(0);
    expect(Object.keys(searchCall.tools)).toEqual(["web_search"]);
    expect(searchCall.tools.web_search.args.maxUses).toBe(4);
    expect(Object.keys(fetchCall.tools)).toEqual(["web_fetch"]);
    expect(fetchCall.tools.web_fetch.args).toMatchObject({ maxUses: 4, allowedDomains: ["prusa.example"] });
    // The candidate pages are in the prompt, because web_fetch opens only URLs it has seen.
    expect(fetchCall.prompt).toContain(MANUAL_URL);
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

    const search = await searchItem(id, REQUEST);
    if (search.skip) throw new Error("expected findings");
    expect(await fetchAndVerifyItem(id, REQUEST, search.findings)).toEqual({ outcome: "researched", confidence: "low" });

    const research = (await getPendingTool(id))?.research;
    expect(research?.confidence.level).toBe("low");
    expect(research?.confidence.basis).not.toContain("The page says so");
  });

  it.each([429, 500, 529])("throws RetryableError on HTTP %i and leaves the row researching for the retry", async (status) => {
    const id = await queuedItem();
    ai.generateText.mockRejectedValueOnce(apiError(status));

    const error = await searchItem(id, REQUEST).catch((e: unknown) => e);
    expect(RetryableError.is(error)).toBe(true);
    expect(await statusOf(id)).toBe("researching");

    // The retry finds the row its own first attempt claimed, and carries on.
    answer(FINDINGS);
    const retried = await searchItem(id, REQUEST);
    expect(retried.skip).toBe(false);
    expect(await statusOf(id)).toBe("researching");
  });

  it("throws RetryableError from the read pass too, and the row still resumes", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    const search = await searchItem(id, REQUEST);
    if (search.skip) throw new Error("expected findings");

    ai.generateText.mockRejectedValueOnce(apiError(503));
    expect(RetryableError.is(await fetchAndVerifyItem(id, REQUEST, search.findings).catch((e: unknown) => e))).toBe(true);
    expect(await statusOf(id)).toBe("researching");

    expect((await fetchAndVerifyItem(id, REQUEST, search.findings)).outcome).toBe("researched");
  });

  it("throws FatalError on a 400", async () => {
    const id = await queuedItem();
    ai.generateText.mockRejectedValueOnce(apiError(400));
    const error = await searchItem(id, REQUEST).catch((e: unknown) => e);
    expect(FatalError.is(error)).toBe(true);
    expect((error as Error).message).toContain("HTTP 400");
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
    const fetchError = await fetchAndVerifyItem(id, REQUEST, parseSearchFindings(JSON.stringify(FINDINGS))).catch(
      (e: unknown) => e
    );
    expect(FatalError.is(fetchError)).toBe(true);
  });

  it("stops without writing when the item was discarded before the step ran", async () => {
    const id = await queuedItem();
    const discarded = await discardPendingTool(id);
    expect(discarded.ok).toBe(true);
    answer(FINDINGS);

    expect(await searchItem(id, REQUEST)).toEqual({ skip: true });
    expect(ai.generateText).not.toHaveBeenCalled();
    const item = await getPendingTool(id);
    expect(item?.status).toBe("discarded");
    expect(item?.research).toBeNull();

    // A read pass for a row that is not researching writes nothing either.
    expect(await fetchAndVerifyItem(id, REQUEST, parseSearchFindings(JSON.stringify(FINDINGS)))).toEqual({ outcome: "skipped" });
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
    answer(FINDINGS);

    expect(await searchItem(id, REQUEST)).toEqual({ skip: true });
    expect(ai.generateText).not.toHaveBeenCalled();
    expect(await statusOf(id)).toBe("queued");
    expect(await markItemFailed(id, REQUEST, "not mine")).toBe(false);
  });

  it("does not carry on with a row another run is researching", async () => {
    const id = await queuedItem();
    answer(FINDINGS);
    const other = crypto.randomUUID();
    const db = await getDb();
    await db
      .update(pendingTools)
      .set({ status: "researching", researchRequestId: other })
      .where(eq(pendingTools.id, id));

    expect(await searchItem(id, REQUEST)).toEqual({ skip: true });
    expect(await fetchAndVerifyItem(id, REQUEST, parseSearchFindings(JSON.stringify(FINDINGS)))).toEqual({
      outcome: "skipped",
    });
    expect(ai.generateText).not.toHaveBeenCalled();
  });

  it("stores 'found nothing' as researched with low confidence and no links — never failed, never invented", async () => {
    const id = await queuedItem("Unknown vinyl cutter");
    answer({ canonicalName: "", evidence: { userStatedModel: true } });

    const search = await searchItem(id, REQUEST);
    if (search.skip) throw new Error("expected findings");
    expect(await fetchAndVerifyItem(id, REQUEST, search.findings)).toEqual({ outcome: "researched", confidence: "low" });

    // Nothing to open, so no read pass was spent.
    expect(calls()).toHaveLength(1);
    const item = await getPendingTool(id);
    expect(item?.status).toBe("researched");
    expect(item?.research?.resources).toEqual([]);
    expect(item?.research?.sourceUrls).toEqual([]);
    expect(item?.research?.specs).toEqual([]);
    expect(item?.research?.canonicalName).toBe(item?.name);
  });

  it("sets maxRetries as a property on each model step", () => {
    expect((searchItem as unknown as { maxRetries: number }).maxRetries).toBe(RESEARCH_STEP_MAX_RETRIES);
    expect((fetchAndVerifyItem as unknown as { maxRetries: number }).maxRetries).toBe(RESEARCH_STEP_MAX_RETRIES);
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
