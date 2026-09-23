// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayModelNotFoundError } from "@ai-sdk/gateway";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { makePng, makeProductPng } from "../../../test/gateway/png";
import { Canvas } from "../../../test/images/synthetic";
import { server } from "../../../test/msw/server";
import { setResolvedAddresses } from "../../../test/web/resolver";
import { claimAttachments, createAttachment } from "../data/attachments";
import { createPendingBatch, getPendingTool, markResearching, queueForResearch } from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { attachments } from "../db/schema/index";
import { inspectImage } from "../images/inspect";
import { IMAGE_STEP_MAX_RETRIES } from "../intake/limits";
import type { ImageHint } from "../web/read-page";
import { imageErrorText } from "./image-stage";
import { completeWithoutImages, findImages } from "./image-steps";
import type { ResearchResult } from "./result";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { recordedCalls, resetModelStubs, scriptedModel, setLanguageModel, textModel } from "../../../test/ai/models-stub";

/**
 * The image stage called as plain functions (gateway spec §10 "Integration:
 * findImages"). Without the workflow compiler `"use step"` is only a string, so
 * these run here against the seeded PGlite database, with the ranking job
 * stubbed at the registry, every image answered by MSW and every name resolved
 * by test/web/resolver.ts — no key, no network, no Blob unless a test opts into
 * the local store in a temporary folder. The cutout is real (`sharp`): no
 * model is involved in removing a background.
 */

const REQUEST = crypto.randomUUID();
const PAGE = "https://maker.example/p1s";

const RESULT: ResearchResult = {
  canonicalName: "Bambu Lab P1S",
  description: "An enclosed FDM 3D printer.",
  specs: [],
  materials: ["PLA"],
  ppeRequired: [],
  tags: ["FDM"],
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
  confidence: { level: "medium", basis: ["Manufacturer page found"], unknowns: [] },
};

const hint = (name: string, source: ImageHint["source"] = "og"): ImageHint => ({
  url: `https://maker.example/img/${name}.png`,
  source,
  pageUrl: source === "exa" ? "https://reviews.example/p1s" : PAGE,
});

/** The three hints a typical product page declares. */
const PAGE_HINTS = [hint("front", "og"), hint("side", "twitter"), hint("box", "jsonld")];

let imageRequests: string[];

/** A product already cut out: a transparent PNG with a red box in the middle. */
let CUT_OUT_PNG: Uint8Array;
/** A white machine body filling the frame, with a small dark display — plain, but the cut would eat it. */
let WHITE_BODY_PNG: Uint8Array;
/** A store banner: an orange price bar, a blue product on white, two promotional tiles below. */
let BANNER_PNG: Uint8Array;

/**
 * Every `https://maker.example/img/<name>.png` answers a real 1200×900 PNG: a
 * busy pattern by default, `studio*` a product on white (plain), `cutout*` an
 * already transparent product, `whitebody*` a white machine on white; `tiny`
 * a 100 px one.
 */
function serveImages() {
  server.use(
    http.get("https://maker.example/img/:file", ({ params }) => {
      const file = String(params.file);
      imageRequests.push(file);
      const size = file.startsWith("tiny") ? 100 : 1200;
      const bytes = file.startsWith("studio")
        ? makeProductPng({ width: 1200, height: 900 })
        : file.startsWith("cutout")
          ? CUT_OUT_PNG
          : file.startsWith("whitebody")
            ? WHITE_BODY_PNG
            : file.startsWith("banner")
              ? BANNER_PNG
              : makePng({ width: size, height: (size * 3) / 4, alpha: false });
      return HttpResponse.arrayBuffer(bytes.slice().buffer, { headers: { "content-type": "image/png" } });
    })
  );
}

async function researchingItem(): Promise<string> {
  const { items } = await createPendingBatch({
    createdBy: DEMO_ACCOUNTS.admin.id,
    items: [{ name: `Image stage item ${crypto.randomUUID().slice(0, 8)}`, brand: "Bambu Lab" }],
  });
  const [id] = items.map((item) => item.id);
  await queueForResearch([id], { requestedBy: DEMO_ACCOUNTS.admin.id, requestId: REQUEST });
  expect(await markResearching(id, { requestId: REQUEST })).not.toBeNull();
  return id;
}

async function ownedBy(id: string) {
  const db = await getDb();
  return db.select().from(attachments).where(eq(attachments.ownerId, id));
}

/** A ranking model answering `order` for however many images it is shown. */
function ranking(order: number[]) {
  const model = textModel(JSON.stringify({ order, reasons: order.map((n) => `reason ${n}`) }));
  setLanguageModel("imageRank", model);
  return model;
}

let blobDir: string | null = null;

/** Opt into the local Blob store, in a temporary folder. */
async function useLocalBlob(): Promise<string> {
  blobDir = await mkdtemp(join(tmpdir(), "image-steps-"));
  vi.spyOn(process, "cwd").mockReturnValue(blobDir);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("BLOB_LOCAL_DISABLE", "");
  return blobDir;
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
  CUT_OUT_PNG = await new Canvas(1200, 900, [0, 0, 0, 0]).rect(300, 200, 600, 500, [200, 30, 30, 255]).png({ alpha: true });
  WHITE_BODY_PNG = await new Canvas(1200, 900).rect(520, 300, 160, 80, [20, 20, 20, 255]).png();
  const orange: [number, number, number, number] = [240, 110, 30, 255];
  const banner = new Canvas(1200, 900).rect(40, 20, 1120, 120, orange).rect(450, 250, 300, 350, [30, 60, 160, 255]);
  for (const left of [40, 620]) banner.rect(left, 700, 540, 50, orange).rect(left + 200, 760, 140, 120, [40, 40, 40, 255]);
  BANNER_PNG = await banner.png();
});

beforeEach(() => {
  imageRequests = [];
  serveImages();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  resetModelStubs();
  if (blobDir) await rm(blobDir, { recursive: true, force: true });
  blobDir = null;
});

afterAll(() => {
  resetDbForTests();
});

describe("findImages", () => {
  it("is a step with its own retries", () => {
    expect(findImages.maxRetries).toBe(IMAGE_STEP_MAX_RETRIES);
  });

  it("skips the stage for an item with an uploaded photo, spending nothing", async () => {
    const id = await researchingItem();
    const db = await getDb();
    const photo = await createAttachment({
      blobPathname: "uploads/chat/p1s.jpg",
      access: "private",
      publicUrl: null,
      contentType: "image/jpeg",
      sizeBytes: 10,
      originalFilename: "p1s.jpg",
      uploadedBy: DEMO_ACCOUNTS.admin.id,
      origin: "upload",
    });
    await claimAttachments(db, [photo.id], { ownerType: "pending_tool", ownerId: id });

    // No model stubbed: a ranking call would throw.
    expect(await findImages(id, REQUEST, RESULT, PAGE_HINTS)).toEqual({ outcome: "researched", confidence: "medium" });

    const row = await getPendingTool(id);
    expect(row?.status).toBe("researched");
    expect(row?.research?.images).toBeNull();
    expect(row?.research?.imageError).toBeNull();
    expect(row?.research?.canonicalName).toBe("Bambu Lab P1S");
    expect(imageRequests).toEqual([]);
  });

  it("records no candidates when research found no image", async () => {
    const id = await researchingItem();
    expect(await findImages(id, REQUEST, RESULT, [])).toEqual({ outcome: "researched", confidence: "medium" });
    const research = (await getPendingTool(id))?.research;
    expect(research?.images).toEqual({ candidates: [], cleaned: null });
    expect(research?.imageError).toBeNull();
  });

  it("records no candidates when none survives the probe", async () => {
    const id = await researchingItem();
    await findImages(id, REQUEST, RESULT, [hint("tiny-1"), hint("tiny-2", "exa")]);
    expect((await getPendingTool(id))?.research?.images).toEqual({ candidates: [], cleaned: null });
  });

  it("ranks three candidates and records them in rank order, with their backgrounds — with no Blob store, nothing is cut", async () => {
    const id = await researchingItem();
    const rank = ranking([2, 0, 1]);

    const exaHint = hint("from-exa", "exa");
    expect(await findImages(id, REQUEST, RESULT, [...PAGE_HINTS, exaHint])).toEqual({
      outcome: "researched",
      confidence: "medium",
    });

    const images = (await getPendingTool(id))?.research?.images;
    expect(images?.candidates).toEqual([
      { url: PAGE_HINTS[2].url, pageUrl: PAGE, source: "jsonld", width: 1200, height: 900, contentType: "image/png", rank: 1, reason: "reason 2", background: "busy" },
      { url: PAGE_HINTS[0].url, pageUrl: PAGE, source: "og", width: 1200, height: 900, contentType: "image/png", rank: 2, reason: "reason 0", background: "busy" },
      { url: PAGE_HINTS[1].url, pageUrl: PAGE, source: "twitter", width: 1200, height: 900, contentType: "image/png", rank: 3, reason: "reason 1", background: "busy" },
    ]);
    expect(images?.cleaned).toBeNull();
    expect(images?.cleanNote).toBeUndefined();
    // Three page images: Exa's is not even probed.
    expect(imageRequests.sort()).toEqual(["box.png", "front.png", "side.png"]);
    // The ranking call names the machine and has no tools.
    const [call] = recordedCalls(rank);
    expect(JSON.stringify(call.prompt)).toContain("Machine: Bambu Lab P1S");
    expect(call.tools ?? []).toEqual([]);
    expect(await ownedBy(id)).toEqual([]);
  });

  it("cuts a plain rank 1 out deterministically and stores it private, owned by the item, with the original's URL", async () => {
    const dir = await useLocalBlob();
    const id = await researchingItem();
    ranking([1, 0, 2]);
    const hints = [hint("studio-front"), hint("studio-side", "twitter"), hint("studio-box", "jsonld")];

    await findImages(id, REQUEST, RESULT, hints);

    const images = (await getPendingTool(id))?.research?.images;
    expect(images?.candidates[0]).toMatchObject({ url: hints[1].url, background: "plain" });
    expect(images?.cleaned).toEqual({ attachmentId: expect.any(String), fromUrl: hints[1].url });
    expect(images?.cleanNote).toBeUndefined();

    const [row] = await ownedBy(id);
    const stored = new Uint8Array(await readFile(join(dir, ".blob-data", row.blobPathname)));
    const info = inspectImage(stored);
    expect(info).toMatchObject({ format: "image/png", hasAlpha: true });
    // Trimmed to the product (the middle half of a 1024 px working copy) plus a margin.
    expect(info!.width).toBeLessThan(1024);
    expect(info!.width).toBeGreaterThanOrEqual(512);
    expect(row).toMatchObject({
      id: images?.cleaned?.attachmentId,
      ownerType: "pending_tool",
      access: "private",
      publicUrl: null,
      contentType: "image/png",
      origin: "research_image_cleaned",
      sourceUrl: hints[1].url,
      width: info!.width,
      height: info!.height,
      sizeBytes: stored.byteLength,
    });
    expect(row.blobPathname).toMatch(new RegExp(`^research/cleaned/${id}-\\w+\\.png$`));
  });

  it("prefers a plain shot the model ranked second over a busy first, and cuts it", async () => {
    await useLocalBlob();
    const id = await researchingItem();
    ranking([0, 1]);
    const hints = [hint("front"), hint("studio-side", "twitter")];

    await findImages(id, REQUEST, RESULT, hints);

    const images = (await getPendingTool(id))?.research?.images;
    expect(images?.candidates.map((c) => [c.url, c.background])).toEqual([
      [hints[1].url, "plain"],
      [hints[0].url, "busy"],
    ]);
    expect(images?.cleaned?.fromUrl).toBe(hints[1].url);
  });

  it("cuts nothing from a busy rank 1, and says why", async () => {
    await useLocalBlob();
    const id = await researchingItem();
    ranking([0, 1, 2]);

    await findImages(id, REQUEST, RESULT, PAGE_HINTS);

    const research = (await getPendingTool(id))?.research;
    expect(research?.images?.candidates).toHaveLength(3);
    expect(research?.images?.cleaned).toBeNull();
    expect(research?.images?.cleanNote).toBe("busy_background");
    expect(research?.imageError).toBeNull();
    expect(await ownedBy(id)).toEqual([]);
  });

  it("stores no copy of an already transparent rank 1 — the original is the clean one", async () => {
    await useLocalBlob();
    const id = await researchingItem();
    ranking([0, 1]);
    const hints = [hint("cutout-front"), hint("studio-side", "twitter")];

    await findImages(id, REQUEST, RESULT, hints);

    const images = (await getPendingTool(id))?.research?.images;
    expect(images?.candidates[0]).toMatchObject({ url: hints[0].url, background: "transparent" });
    expect(images?.cleaned).toBeNull();
    expect(images?.cleanNote).toBeUndefined();
    expect(await ownedBy(id)).toEqual([]);
  });

  it("still records the candidates when the cut fails its checks, with the reason", async () => {
    await useLocalBlob();
    const id = await researchingItem();
    ranking([0, 1]);
    const hints = [hint("whitebody-front"), hint("front", "twitter")];

    await findImages(id, REQUEST, RESULT, hints);

    const research = (await getPendingTool(id))?.research;
    expect(research?.images?.candidates[0]).toMatchObject({ url: hints[0].url, background: "plain" });
    expect(research?.images?.cleaned).toBeNull();
    expect(research?.images?.cleanNote).toBe("product_removed");
    expect(research?.imageError).toBeNull();
    expect(await ownedBy(id)).toEqual([]);
  });

  it("crops a banner rank 1 to the product box the ranking gave, cuts its backdrop, and marks the banners", async () => {
    const dir = await useLocalBlob();
    const id = await researchingItem();
    const box = [0.36, 0.26, 0.64, 0.68];
    setLanguageModel(
      "imageRank",
      textModel(
        JSON.stringify({
          order: [0, 1],
          reasons: ["banner, product centred", "banner"],
          images: [
            { composite: true, productBox: box },
            { composite: true, productBox: box },
          ],
        })
      )
    );
    const hints = [hint("banner-a"), hint("banner-b", "jsonld")];

    await findImages(id, REQUEST, RESULT, hints);

    const images = (await getPendingTool(id))?.research?.images;
    expect(images?.candidates.map((c) => c.composite)).toEqual([true, true]);
    expect(images?.cleaned).toEqual({ attachmentId: expect.any(String), fromUrl: hints[0].url, kind: "cropped_and_cut" });
    expect(images?.cleanNote).toBeUndefined();

    const [row] = await ownedBy(id);
    const stored = new Uint8Array(await readFile(join(dir, ".blob-data", row.blobPathname)));
    // The 300 × 350 product plus the cutout's margin — not the 1200 × 900 banner.
    expect(inspectImage(stored)).toMatchObject({ format: "image/png", hasAlpha: true });
    expect(inspectImage(stored)!.width).toBeLessThan(360);
    expect(inspectImage(stored)!.height).toBeLessThan(410);
    expect(row).toMatchObject({ origin: "research_image_cleaned", sourceUrl: hints[0].url, access: "private" });
  });

  it("never fetches a candidate on a private address", async () => {
    const id = await researchingItem();
    const inward = vi.fn();
    server.use(
      http.get("http://169.254.169.254/*", () => (inward(), HttpResponse.text("metadata"))),
      http.get("https://intranet.maker.example/*", () => (inward(), HttpResponse.text("secret")))
    );
    setResolvedAddresses({ "intranet.maker.example": ["10.1.2.3"] });

    await findImages(id, REQUEST, RESULT, [
      { url: "http://169.254.169.254/latest/meta-data/iam", source: "og", pageUrl: PAGE },
      { url: "https://intranet.maker.example/photo.png", source: "twitter", pageUrl: PAGE },
      hint("front", "jsonld"),
    ]);

    expect(inward).not.toHaveBeenCalled();
    // One candidate left needs no ranking call (none is stubbed).
    expect((await getPendingTool(id))?.research?.images?.candidates.map((c) => c.url)).toEqual([hint("front").url]);
  });

  it("records an unreadable ranking as imageError and leaves the item researched", async () => {
    const id = await researchingItem();
    setLanguageModel("imageRank", textModel('{"order":[0,0,7],"reasons":[]}'));

    expect(await findImages(id, REQUEST, RESULT, PAGE_HINTS)).toEqual({ outcome: "researched", confidence: "medium" });

    const research = (await getPendingTool(id))?.research;
    expect(research?.images).toBeNull();
    expect(research?.imageError).toBe("Image ranking: the model's answer could not be read.");
  });

  it("names the variable when the ranking model is misconfigured or unknown", async () => {
    const first = await researchingItem();
    vi.stubEnv("MODEL_IMAGE_RANK", "Not A Model Id");
    await findImages(first, REQUEST, RESULT, PAGE_HINTS);
    expect((await getPendingTool(first))?.research?.imageError).toBe("Image ranking: model not available (MODEL_IMAGE_RANK).");
    vi.unstubAllEnvs();

    const second = await researchingItem();
    setLanguageModel(
      "imageRank",
      scriptedModel(() => {
        throw new GatewayModelNotFoundError({ message: "model sk-abcdefghijkl not found", statusCode: 404 });
      })
    );
    await findImages(second, REQUEST, RESULT, PAGE_HINTS);
    expect((await getPendingTool(second))?.research?.imageError).toBe("Image ranking: model not available (MODEL_IMAGE_RANK).");
  });

  it("releases a cleaned copy an earlier attempt left on the item", async () => {
    const id = await researchingItem();
    const db = await getDb();
    const old = await createAttachment({
      blobPathname: "research/cleaned/old.png",
      access: "private",
      publicUrl: null,
      contentType: "image/png",
      sizeBytes: 1,
      originalFilename: "background-removed.png",
      uploadedBy: null,
      origin: "research_image_cleaned",
      sourceUrl: "https://maker.example/img/front.png",
    });
    await claimAttachments(db, [old.id], { ownerType: "pending_tool", ownerId: id });

    await findImages(id, REQUEST, RESULT, []);

    expect(await ownedBy(id)).toEqual([]);
    // Not counted as an uploaded photo: the stage ran.
    expect((await getPendingTool(id))?.research?.images).toEqual({ candidates: [], cleaned: null });
  });

  it("writes nothing to a row that is no longer this run's", async () => {
    const id = await researchingItem();
    expect(await findImages(id, crypto.randomUUID(), RESULT, PAGE_HINTS)).toEqual({ outcome: "skipped" });
    const row = await getPendingTool(id);
    expect(row?.status).toBe("researching");
    expect(row?.research).toBeNull();
    expect(imageRequests).toEqual([]);
  });

  it("throws for what it did not expect, without quoting it — and completeWithoutImages still researches the item", async () => {
    const id = await researchingItem();
    setLanguageModel(
      "imageRank",
      scriptedModel(() => {
        throw new TypeError("cannot read https://secret.example/?token=sk-abcdefghijkl");
      })
    );

    const failure = await findImages(id, REQUEST, RESULT, PAGE_HINTS).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toBe("The image search failed unexpectedly (TypeError).");
    expect((await getPendingTool(id))?.status).toBe("researching");

    expect(await completeWithoutImages(id, REQUEST, RESULT, message)).toEqual({ outcome: "researched", confidence: "medium" });
    const row = await getPendingTool(id);
    expect(row?.status).toBe("researched");
    expect(row?.research?.images).toBeNull();
    expect(row?.research?.imageError).toBe(message);
    expect(row?.research?.description).toBe(RESULT.description);
  });
});

describe("completeWithoutImages", () => {
  it("skips a row that is no longer this run's", async () => {
    const id = await researchingItem();
    expect(await completeWithoutImages(id, crypto.randomUUID(), RESULT, "x")).toEqual({ outcome: "skipped" });
    expect((await getPendingTool(id))?.status).toBe("researching");
  });

  it("releases any cleaned copy and stores a clipped, scrubbed reason", async () => {
    const id = await researchingItem();
    const db = await getDb();
    const cleaned = await createAttachment({
      blobPathname: "research/cleaned/x.png",
      access: "private",
      publicUrl: null,
      contentType: "image/png",
      sizeBytes: 1,
      originalFilename: "background-removed.png",
      uploadedBy: null,
      origin: "research_image_cleaned",
      sourceUrl: "https://maker.example/img/front.png",
    });
    await claimAttachments(db, [cleaned.id], { ownerType: "pending_tool", ownerId: id });

    await completeWithoutImages(id, REQUEST, RESULT, `Boom at https://maker.example/a?key=1 with sk-abcdefghijkl\n${"x".repeat(400)}`);

    expect(await ownedBy(id)).toEqual([]);
    const imageError = (await getPendingTool(id))?.research?.imageError ?? "";
    expect(imageError.length).toBeLessThanOrEqual(200);
    expect(imageError).toMatch(/^Boom at \[link\] with \[redacted\] x+…$/);
  });
});

describe("imageErrorText", () => {
  it("says something when there is nothing to say", () => {
    expect(imageErrorText("   ")).toBe("The image search failed.");
  });
});
