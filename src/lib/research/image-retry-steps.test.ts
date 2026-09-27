// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { makeProductPng } from "../../../test/gateway/png";
import { server } from "../../../test/msw/server";
import { failImageRetry, startImageRetry } from "../data/image-retry";
import { completeResearch, createPendingBatch, getPendingTool, markResearching, queueForResearch } from "../data/pending-tools";
import { recordCleanedImage } from "../data/research-images";
import { getDb, resetDbForTests } from "../db/client";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { attachments, researchRequests } from "../db/schema/index";
import { IMAGE_STEP_MAX_RETRIES } from "../intake/limits";
import { imageIdentity } from "../web/image-url";
import type { ImageCandidate, ResearchImages, ResearchResult } from "./result";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, scriptedModel, setLanguageModel, textModel } from "../../../test/ai/models-stub";
import { markImageRetryFailed, retryImages, retryCandidates } from "./image-retry-steps";

/**
 * **Find a different image** (amendment "Product-page first, front-facing
 * images, reviewer notes"), its step called as a plain function against the
 * seeded PGlite database: the pages answered by MSW, the search and ranking
 * models stubbed at the registry, the cutout real, Blob a local folder.
 */

const PAGE = "https://maker.example/x2d";
const OLD_URL = "https://maker.example/img/old-back.png";
const NEW_URL = "https://maker.example/img/studio-new.png";
const EXA_URL = "https://maker.example/img/studio-exa.png";
const ADMIN = DEMO_ACCOUNTS.admin.id;

const OLD: ImageCandidate = {
  url: OLD_URL,
  pageUrl: PAGE,
  source: "og",
  width: 1200,
  height: 900,
  contentType: "image/png",
  rank: 1,
  reason: "the back of the printer",
  view: "back",
};

const RESULT: ResearchResult = {
  canonicalName: "Bambu Lab X2D",
  description: "A dual-nozzle FDM printer.",
  specs: [],
  materials: [],
  ppeRequired: [],
  tags: [],
  trainingRequired: true,
  useRestrictions: null,
  category: { name: "FDM", group: "3D Printing", existingId: null },
  resources: [],
  droppedLinks: [],
  sourceUrls: [PAGE],
  evidence: {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: true,
    manualFound: false,
    specsFromSource: true,
    categoryOnly: false,
  },
  confidence: { level: "medium", basis: [], unknowns: [] },
};

let blobDir: string | null = null;
let pageImages: string[];
let exaImages: string[];

async function useLocalBlob() {
  blobDir = await mkdtemp(join(tmpdir(), "image-retry-"));
  vi.spyOn(process, "cwd").mockReturnValue(blobDir);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("BLOB_LOCAL_DISABLE", "");
}

/** A researched item whose images are `OLD` plus a cleaned copy of it; answers its id and that copy's id. */
async function researchedItem(): Promise<{ id: string; oldCleaned: string }> {
  const request = crypto.randomUUID();
  const { items } = await createPendingBatch({
    createdBy: ADMIN,
    items: [{ name: `Retry item ${crypto.randomUUID().slice(0, 8)}`, brand: "Bambu Lab" }],
  });
  const [id] = items.map((item) => item.id);
  await queueForResearch([id], { requestedBy: ADMIN, requestId: request });
  await markResearching(id, { requestId: request });
  const db = await getDb();
  const oldCleaned = await recordCleanedImage(db, {
    pendingId: id,
    blobPathname: `research/cleaned/${id}-old.png`,
    sizeBytes: 10,
    width: 10,
    height: 10,
    fromUrl: OLD_URL,
  });
  const images: ResearchImages = { candidates: [OLD], cleaned: { attachmentId: oldCleaned, fromUrl: OLD_URL } };
  expect(await completeResearch(id, { ...RESULT, images }, { requestId: request })).toBe(true);
  return { id, oldCleaned };
}

async function begin(id: string, note: string | null = null): Promise<string> {
  const requestId = crypto.randomUUID();
  const started = await startImageRetry(id, { requestedBy: ADMIN, requestId, note, limit: 100, since: new Date(Date.now() - 86_400_000) });
  expect(started).toEqual({ ok: true });
  return requestId;
}

/** The search model: one provider-executed exa_search reporting `exaImages`, then "done". */
function searchModel() {
  return scriptedModel(() => ({
    content: [
      { type: "tool-call", toolCallId: "exa_1", toolName: "exa_search", input: JSON.stringify({ query: "X2D" }), providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "exa_1",
        toolName: "exa_search",
        result: { requestId: "exa_req", results: exaImages.map((image) => ({ id: PAGE, url: PAGE, title: "X2D", image })) },
      },
      { type: "text", text: "done" },
    ],
    finishReason: "stop",
  }));
}

async function owner(attachmentId: string) {
  const db = await getDb();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  return row?.ownerId ?? null;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

beforeEach(() => {
  pageImages = [OLD_URL, NEW_URL];
  exaImages = [EXA_URL];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  server.use(
    http.get(PAGE, () =>
      HttpResponse.html(
        `<html><head><title>X2D</title>${pageImages
          .map((url, n) => `<meta property="${n === 0 ? "og:image" : "twitter:image"}" content="${url}">`)
          .join("")}</head><body><main><p>The X2D.</p></main></body></html>`
      )
    ),
    http.get("https://maker.example/img/:file", () => {
      const bytes = makeProductPng({ width: 1200, height: 900 });
      return HttpResponse.arrayBuffer(bytes.slice().buffer, { headers: { "content-type": "image/png" } });
    })
  );
});

afterEach(async () => {
  resetModelStubs();
  if (blobDir) await rm(blobDir, { recursive: true, force: true });
  blobDir = null;
});

afterAll(() => {
  resetDbForTests();
});

describe("retryImages", () => {
  it("is a step with its own retries", () => {
    expect(retryImages.maxRetries).toBe(IMAGE_STEP_MAX_RETRIES);
  });

  it("replaces the images with pictures not shown before, releases the old cleaned copy, and passes the note to search and ranking", async () => {
    await useLocalBlob();
    const { id, oldCleaned } = await researchedItem();
    const note = "front-facing photo of the whole printer";
    const requestId = await begin(id, note);
    const search = searchModel();
    setLanguageModel("researchSearch", search);
    // Search first (a note aimed it): [exa, new]. The model prefers index 1.
    const rank = textModel(
      JSON.stringify({ order: [1, 0], reasons: ["front of the X2D", "angled"], images: [{ subject: "product" }, { subject: "product" }] })
    );
    setLanguageModel("imageRank", rank);

    expect(await retryImages(id, requestId, note)).toBe("done");

    const research = (await getPendingTool(id))?.research;
    expect(research?.images?.candidates.map((c) => c.url)).toEqual([NEW_URL, EXA_URL]);
    expect(research?.images?.candidates.map((c) => c.url)).not.toContain(OLD_URL);
    expect(research?.images?.cleaned?.fromUrl).toBe(NEW_URL);
    expect(research?.images?.cleaned?.attachmentId).not.toBe(oldCleaned);
    expect(research?.imageRetry).toMatchObject({ requestId, status: "done", note, error: null });
    // The rest of the result is untouched.
    expect(research?.description).toBe(RESULT.description);

    expect(await owner(oldCleaned)).toBeNull();
    expect(await owner(research!.images!.cleaned!.attachmentId)).toBe(id);

    expect(recordedCalls(search)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
    expect(recordedCalls(rank)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
    const searchPrompt = JSON.stringify(recordedCalls(search)[0].prompt);
    expect(searchPrompt).toContain(`<reviewer-instruction>\\n${note}\\n</reviewer-instruction>`);
    expect(JSON.stringify(recordedCalls(rank)[0].prompt)).toContain(`<reviewer-instruction>\\n${note}\\n</reviewer-instruction>`);
  });

  it("fails, keeping the old images, when nothing new turns up", async () => {
    const { id, oldCleaned } = await researchedItem();
    pageImages = [OLD_URL];
    exaImages = [OLD_URL];
    const requestId = await begin(id);
    setLanguageModel("researchSearch", searchModel());

    expect(await retryImages(id, requestId, null)).toBe("failed");

    const research = (await getPendingTool(id))?.research;
    expect(research?.images?.candidates).toEqual([OLD]);
    expect(research?.images?.cleaned?.attachmentId).toBe(oldCleaned);
    expect(research?.imageRetry).toMatchObject({ status: "failed", error: "No other picture of it was found." });
    expect(await owner(oldCleaned)).toBe(id);
  });

  it("writes nothing for a run that is no longer the latest", async () => {
    const { id } = await researchedItem();
    await begin(id);
    // No model stubbed: any call would throw.
    expect(await retryImages(id, crypto.randomUUID(), null)).toBe("skipped");
    expect((await getPendingTool(id))?.research?.images?.candidates).toEqual([OLD]);
  });

  it("records a workflow-level failure on the run", async () => {
    const { id } = await researchedItem();
    const requestId = await begin(id);
    expect(await markImageRetryFailed(id, requestId, "The image search failed unexpectedly (TypeError).")).toBe(true);
    expect((await getPendingTool(id))?.research?.imageRetry).toMatchObject({
      status: "failed",
      error: "The image search failed unexpectedly (TypeError).",
    });
  });
});

describe("startImageRetry", () => {
  it("costs one against the daily allowance, and refuses past it", async () => {
    const { id } = await researchedItem();
    const db = await getDb();
    const since = new Date(Date.now() - 86_400_000);
    const requestId = crypto.randomUUID();

    const { used } = { used: (await db.select().from(researchRequests).where(eq(researchRequests.userId, ADMIN))).length };
    expect(await startImageRetry(id, { requestedBy: ADMIN, requestId: crypto.randomUUID(), note: null, limit: used, since })).toEqual({
      ok: false,
      reason: "daily_limit",
      remaining: 0,
    });

    expect(await startImageRetry(id, { requestedBy: ADMIN, requestId, note: null, limit: used + 1, since })).toEqual({ ok: true });
    const ledger = await db.select().from(researchRequests).where(eq(researchRequests.requestId, requestId));
    expect(ledger).toEqual([expect.objectContaining({ userId: ADMIN, pendingToolId: id })]);
  });

  it("refuses a second run while one is going, and allows one once it has failed", async () => {
    const { id } = await researchedItem();
    const first = await begin(id);
    const input = { requestedBy: ADMIN, note: null, limit: 1000, since: new Date(Date.now() - 86_400_000) };
    expect(await startImageRetry(id, { ...input, requestId: crypto.randomUUID() })).toEqual({ ok: false, reason: "image_retry_running" });
    await failImageRetry(id, first, "gave up");
    expect(await startImageRetry(id, { ...input, requestId: crypto.randomUUID() })).toEqual({ ok: true });
  });

  it("treats a run still marked running after the stale window as dead", async () => {
    const { id } = await researchedItem();
    await begin(id);
    const later = new Date(Date.now() + 16 * 60_000);
    expect(
      await startImageRetry(id, { requestedBy: ADMIN, requestId: crypto.randomUUID(), note: null, limit: 1000, since: new Date(0), now: later })
    ).toEqual({ ok: true });
  });

  it("refuses an item that is not researched", async () => {
    const { items } = await createPendingBatch({ createdBy: ADMIN, items: [{ name: "Not researched yet", brand: null }] });
    expect(
      await startImageRetry(items[0].id, { requestedBy: ADMIN, requestId: crypto.randomUUID(), note: null, limit: 1000, since: new Date(0) })
    ).toEqual({ ok: false, reason: "not_editable" });
  });
});

describe("retryCandidates", () => {
  const subject = { brand: "Bambu Lab", name: "Bambu Lab X2D" };
  const hint = (url: string, source: "og" | "exa" = "og") => ({ url, source, pageUrl: PAGE });

  it("leaves out what was shown, and leads with the search's pictures only when a note aimed it", () => {
    const shown = new Set([imageIdentity(OLD_URL)]);
    const pages = [hint(OLD_URL), hint(NEW_URL)];
    const exa = [hint(EXA_URL, "exa")];
    expect(retryCandidates(pages, exa, { shown, subject, searchFirst: true }).map((h) => h.url)).toEqual([EXA_URL, NEW_URL]);
    expect(retryCandidates(pages, exa, { shown, subject, searchFirst: false }).map((h) => h.url)).toEqual([NEW_URL, EXA_URL]);
  });
});
