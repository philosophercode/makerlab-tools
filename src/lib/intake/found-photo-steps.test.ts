// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { GatewayModelNotFoundError } from "@ai-sdk/gateway";
import { http, HttpResponse } from "msw";
import { makeProductPng } from "../../../test/gateway/png";
import { server } from "../../../test/msw/server";
import { startFoundPhotoSearch } from "../data/found-photo";
import { createPendingBatch, getPendingTool } from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { attachments, pendingTools } from "../db/schema/index";
import { IDENTIFY_PHOTO_MAX_RETRIES } from "./limits";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, scriptedModel, setLanguageModel, textModel } from "../../../test/ai/models-stub";
import { findFoundPhoto, markFoundPhotoFailed } from "./found-photo-steps";

/**
 * A photo for an item named without one (data platform spec amendment "A
 * photo for a name"): the lookup's step called as a plain function against the
 * seeded PGlite database — the search and ranking models stubbed at the
 * registry, the pictures answered by MSW, the cutout real, Blob a local folder.
 */

const PAGE = "https://www.maker.example/x2d";
const FRONT = "https://www.maker.example/img/x2d-front.png";
const SIDE = "https://www.maker.example/img/x2d-side.png";
const ADMIN = DEMO_ACCOUNTS.admin.id;

let blobDir: string | null = null;
let exaImages: string[];

async function useLocalBlob() {
  blobDir = await mkdtemp(join(tmpdir(), "found-photo-"));
  vi.spyOn(process, "cwd").mockReturnValue(blobDir);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("BLOB_LOCAL_DISABLE", "");
}

/** An identified item named without a photo, its lookup marked searching. */
async function searchingItem(): Promise<{ id: string; requestId: string }> {
  const { items } = await createPendingBatch({
    createdBy: ADMIN,
    items: [{ name: `Bambu Lab X2D ${crypto.randomUUID().slice(0, 6)}`, brand: "Bambu Lab" }],
  });
  const id = items[0].id;
  const requestId = crypto.randomUUID();
  await startFoundPhotoSearch([id], { requestedBy: ADMIN, requestId, limit: 1000, since: new Date(Date.now() - 86_400_000) });
  return { id, requestId };
}

/** The search model: one provider-executed exa_search reporting `exaImages`, then "done". */
function searchModel() {
  return scriptedModel(() => ({
    content: [
      { type: "tool-call", toolCallId: "exa_1", toolName: "exa_search", input: JSON.stringify({ query: "Bambu Lab X2D" }), providerExecuted: true },
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
  return { ownerId: row?.ownerId ?? null, origin: row?.origin ?? null, access: row?.access ?? null };
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

beforeEach(() => {
  exaImages = [SIDE, FRONT];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  server.use(
    http.get("https://www.maker.example/img/:file", () => {
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

describe("findFoundPhoto", () => {
  it("is a step with its own retry", () => {
    expect(findFoundPhoto.maxRetries).toBe(IDENTIFY_PHOTO_MAX_RETRIES);
  });

  it("finds one picture with research's finder — one search, the ranking, the cutout — and keeps rank 1", async () => {
    await useLocalBlob();
    const { id, requestId } = await searchingItem();
    const search = searchModel();
    setLanguageModel("researchSearch", search);
    // Candidates [side, front]; the model prefers the front (index 1).
    const rank = textModel(
      JSON.stringify({ order: [1, 0], reasons: ["front of the X2D", "side"], images: [{ subject: "product" }, { subject: "product" }] })
    );
    setLanguageModel("imageRank", rank);

    expect(await findFoundPhoto(id, requestId)).toBe("found");

    const found = (await getPendingTool(id))?.foundPhoto;
    expect(found).toMatchObject({ requestId, status: "found", error: null });
    expect(found?.candidate).toMatchObject({ url: FRONT, pageUrl: PAGE, rank: 1 });
    // The plain-backdrop winner was cut out, private, owned by the item — never one of its photos.
    expect(found?.cleaned?.fromUrl).toBe(FRONT);
    expect(await owner(found!.cleaned!.attachmentId)).toEqual({ ownerId: id, origin: "research_image_cleaned", access: "private" });
    expect((await getPendingTool(id))?.photos).toEqual([]);

    // One flex search, one flex ranking; the search is told the name and brand only.
    expect(recordedCalls(search)).toHaveLength(1);
    expect(recordedCalls(search)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
    expect(recordedCalls(rank)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
    expect(JSON.stringify(recordedCalls(search)[0].prompt)).toContain("Brand: Bambu Lab");
  });

  it("answers none when the search finds no picture", async () => {
    const { id, requestId } = await searchingItem();
    exaImages = [];
    setLanguageModel("researchSearch", searchModel());
    expect(await findFoundPhoto(id, requestId)).toBe("none");
    expect((await getPendingTool(id))?.foundPhoto).toMatchObject({ status: "none", candidate: null, cleaned: null });
  });

  it("answers none when the ranking judges no picture the product itself", async () => {
    const { id, requestId } = await searchingItem();
    setLanguageModel("researchSearch", searchModel());
    setLanguageModel(
      "imageRank",
      textModel(JSON.stringify({ order: [0, 1], reasons: ["a nozzle", "a spool"], images: [{ subject: "part" }, { subject: "consumable" }] }))
    );
    expect(await findFoundPhoto(id, requestId)).toBe("none");
    expect((await getPendingTool(id))?.foundPhoto?.status).toBe("none");
  });

  it("records a model failure as failed, with the reason in a line", async () => {
    const { id, requestId } = await searchingItem();
    setLanguageModel(
      "researchSearch",
      scriptedModel(() => {
        throw new GatewayModelNotFoundError({ message: "model not found", statusCode: 404 });
      })
    );
    expect(await findFoundPhoto(id, requestId)).toBe("failed");
    const found = (await getPendingTool(id))?.foundPhoto;
    expect(found?.status).toBe("failed");
    expect(found?.error).toBe("Image search: model not available (MODEL_RESEARCH_SEARCH).");
  });

  it("does nothing for a lookup that is not this run's, or an item discarded meanwhile", async () => {
    const { id, requestId } = await searchingItem();
    // No model stubbed: any call would throw.
    expect(await findFoundPhoto(id, crypto.randomUUID())).toBe("skipped");
    const db = await getDb();
    await db.update(pendingTools).set({ status: "discarded" }).where(eq(pendingTools.id, id));
    expect(await findFoundPhoto(id, requestId)).toBe("skipped");
  });

  it("markFoundPhotoFailed records the workflow's reason", async () => {
    const { id, requestId } = await searchingItem();
    expect(await markFoundPhotoFailed(id, requestId, "The photo search failed unexpectedly (TypeError).")).toBe(true);
    expect((await getPendingTool(id))?.foundPhoto).toMatchObject({ status: "failed", error: "The photo search failed unexpectedly (TypeError)." });
  });
});
