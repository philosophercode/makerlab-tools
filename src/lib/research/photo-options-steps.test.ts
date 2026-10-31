// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { makeProductPng } from "../../../test/gateway/png";
import { server } from "../../../test/msw/server";
import { listAttachmentsForOwner } from "../data/attachments";
import { finishPhotoSearch, getPhotoSearch, latestPhotoSearch, startPhotoSearch } from "../data/photo-searches";
import { readToolRevision } from "../data/tools";
import { getDb, resetDbForTests } from "../db/client";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { attachments, resources, tools } from "../db/schema/index";
import { IMAGE_STEP_MAX_RETRIES } from "../intake/limits";
import { PHOTO_PREFERENCE } from "../photo-options/candidates";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, scriptedModel, setLanguageModel, textModel } from "../../../test/ai/models-stub";
import { pickPhotoOption } from "../photo-options/pick";
import { markPhotoSearchFailed, searchPhotoOptions } from "./photo-options-steps";

/**
 * **Find photo options** (photo options spec 2026-10-29 §3), its step called
 * as a plain function against the seeded PGlite database: the tool's own page
 * answered by MSW, the search and ranking models stubbed at the registry —
 * then a pick, with the real cutout and Blob in a local folder.
 */

const PAGE = "https://maker.example/x2d";
const COVER_URL = "https://maker.example/img/shop-photo.png";
const PAGE_URL = "https://maker.example/img/studio-front.png";
const EXA_PAGE = "https://shop.example/maker-x2d";
const EXA_URL = "https://shop.example/img/listing.png";
const ADMIN = DEMO_ACCOUNTS.admin.id;

let blobDir: string | null = null;
let toolId: string;
let coverId: string;

function searchModel() {
  return scriptedModel(() => ({
    content: [
      { type: "tool-call", toolCallId: "exa_1", toolName: "exa_search", input: JSON.stringify({ query: "Maker X2D" }), providerExecuted: true },
      {
        type: "tool-result",
        toolCallId: "exa_1",
        toolName: "exa_search",
        result: { requestId: "exa_req", results: [{ id: EXA_PAGE, url: EXA_PAGE, title: "Maker X2D", image: EXA_URL }] },
      },
      { type: "text", text: "done" },
    ],
    finishReason: "stop",
  }));
}

async function begin(note: string | null = null): Promise<string> {
  const started = await startPhotoSearch(toolId, { requestedBy: ADMIN, note, limit: 1000, since: new Date(Date.now() - 86_400_000) });
  if (!started.ok) throw new Error(`expected a start, got ${started.reason}`);
  return started.searchId;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  const db = await getDb();
  const [tool] = await db
    .insert(tools)
    .values({ slug: `maker-x2d-${crypto.randomUUID().slice(0, 8)}`, name: "Maker X2D" })
    .returning({ id: tools.id });
  toolId = tool.id;
  await db.insert(resources).values({ toolId, title: "Product page", url: PAGE, type: "Link" });
  const [cover] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/tool/${crypto.randomUUID()}.png`,
      access: "public",
      contentType: "image/png",
      ownerType: "tool",
      ownerId: toolId,
      position: 0,
      sourceUrl: COVER_URL,
    })
    .returning({ id: attachments.id });
  coverId = cover.id;

  server.use(
    http.get(PAGE, () =>
      HttpResponse.html(
        `<html><head><title>Maker X2D</title><meta property="og:image" content="${COVER_URL}"><meta name="twitter:image" content="${PAGE_URL}"></head><body><main><p>The X2D.</p></main></body></html>`
      )
    ),
    http.get(/https:\/\/(maker|shop)\.example\/img\/.*/, () => {
      const bytes = makeProductPng({ width: 1200, height: 900 });
      return HttpResponse.arrayBuffer(bytes.slice().buffer, { headers: { "content-type": "image/png" } });
    })
  );
});

afterEach(async () => {
  resetModelStubs();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "");
  if (blobDir) await rm(blobDir, { recursive: true, force: true });
  blobDir = null;
});

afterAll(() => {
  resetDbForTests();
});

describe("searchPhotoOptions", () => {
  it("is a step with its own retries", () => {
    expect(searchPhotoOptions.maxRetries).toBe(IMAGE_STEP_MAX_RETRIES);
  });

  it("offers new pictures, the maker's first, never the current cover's, and tells search and ranking the preference", async () => {
    const searchId = await begin("the white one");
    const search = searchModel();
    setLanguageModel("researchSearch", search);
    // Shown in order [maker page picture, shop listing]; the model ranks the listing first.
    const rank = textModel(
      JSON.stringify({ order: [1, 0], reasons: ["listing", "studio front"], images: [{ subject: "product", view: "front" }, { subject: "product" }] })
    );
    setLanguageModel("imageRank", rank);

    expect(await searchPhotoOptions(searchId)).toBe("done");

    const view = await latestPhotoSearch(toolId);
    expect(view?.status).toBe("ready");
    const urls = view?.options.map((option) => option.url);
    expect(urls).not.toContain(COVER_URL);
    // Same view tier: the maker's own picture leads the shop's (rank.ts's demotePoorViews).
    expect(urls?.[0]).toBe(PAGE_URL);
    expect(urls).toContain(EXA_URL);
    expect(view?.options[0].manufacturer).toBe(true);
    expect(view?.options.find((option) => option.url === EXA_URL)?.manufacturer).toBeUndefined();

    const searchPrompt = JSON.stringify(recordedCalls(search)[0].prompt);
    expect(searchPrompt).toContain(PHOTO_PREFERENCE.slice(0, 40));
    expect(searchPrompt).toContain("the white one");
    expect(JSON.stringify(recordedCalls(rank)[0].prompt)).toContain("the white one");
  });

  it("fails with a reason when every picture was offered before", async () => {
    const first = await begin();
    await finishPhotoSearch(first, [
      { url: PAGE_URL, pageUrl: PAGE, source: "twitter", width: 1200, height: 900, contentType: "image/png", reason: "front" },
      { url: EXA_URL, pageUrl: EXA_PAGE, source: "exa", width: 1200, height: 900, contentType: "image/png", reason: "listing" },
    ]);
    const second = await begin();
    setLanguageModel("researchSearch", searchModel());

    expect(await searchPhotoOptions(second)).toBe("failed");
    expect(await getPhotoSearch(second)).toMatchObject({ status: "failed", error: "No new picture of it was found." });
  });

  it("does nothing for a search that is not running", async () => {
    const searchId = await begin();
    await markPhotoSearchFailed(searchId, "gave up");
    // No model stubbed: any call would throw.
    expect(await searchPhotoOptions(searchId)).toBe("skipped");
  });
});

describe("pickPhotoOption", () => {
  async function useLocalBlob() {
    blobDir = await mkdtemp(join(tmpdir(), "photo-options-"));
    vi.spyOn(process, "cwd").mockReturnValue(blobDir);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("BLOB_LOCAL_DISABLE", "");
  }

  async function readyOptions(): Promise<string> {
    const searchId = await begin();
    await finishPhotoSearch(searchId, [
      { url: PAGE_URL, pageUrl: PAGE, source: "twitter", width: 1200, height: 900, contentType: "image/png", reason: "front", background: "plain" },
    ]);
    return searchId;
  }

  async function context() {
    return { toolId, expectedRevision: (await readToolRevision(toolId))!, actorUserId: ADMIN };
  }

  it("downloads the option, makes it the cover and releases the old one", async () => {
    await useLocalBlob();
    const searchId = await readyOptions();

    const result = await pickPhotoOption(await context(), { searchId, url: PAGE_URL, removeBackground: true, replaceCover: true });

    expect(result).toMatchObject({ ok: true, replacedId: coverId });
    const db = await getDb();
    const photos = await listAttachmentsForOwner(db, { ownerType: "tool", ownerId: toolId });
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ origin: "research_image", sourceUrl: PAGE_URL, access: "public" });
    expect((await getPhotoSearch(searchId))?.chosenUrl).toBe(PAGE_URL);
  });

  it("refuses a URL the search did not record, fetching nothing", async () => {
    const searchId = await readyOptions();
    const result = await pickPhotoOption(await context(), {
      searchId,
      url: "https://evil.example/x.png",
      removeBackground: true,
      replaceCover: true,
    });
    expect(result).toEqual({ ok: false, error: "invalid_field" });
    const db = await getDb();
    const [cover] = await db.select().from(attachments).where(eq(attachments.id, coverId));
    expect(cover.ownerId).toBe(toolId);
  });

  it("says the picture is unavailable when there is nowhere to store it", async () => {
    const searchId = await readyOptions();
    const result = await pickPhotoOption(await context(), { searchId, url: PAGE_URL, removeBackground: true, replaceCover: true }, { store: null });
    expect(result).toEqual({ ok: false, error: "photo_unavailable" });
  });
});
