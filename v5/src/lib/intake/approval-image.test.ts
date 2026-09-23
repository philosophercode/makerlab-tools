// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

/** The audit insert failing on its own, after the approval committed. */
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (event: Parameters<typeof actual.recordAuditEvent>[0]) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event);
    },
  };
});

// Both triggers have their own tests and start workflows; here they only must not.
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../manuals/start", () => ({ startManualArchive: vi.fn(async () => true) }));

import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { makePng } from "../../../test/gateway/png";
import { server } from "../../../test/msw/server";
import { seedUser } from "../../../test/utils/session";
import { setResolvedAddresses } from "../../../test/web/resolver";
import type { BlobStore } from "../blob";
import {
  completeResearch,
  createPendingBatch,
  markResearching,
  queueForResearch,
  type ApprovalFields,
} from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { attachments, auditEvents, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ImageCandidate, ResearchImages, ResearchResult } from "../research/result";
import { approveAndRecord } from "./approve";
import { IMAGE_MAX_BYTES } from "./limits";

/**
 * The product image at approval (gateway spec §5.2, §10 "Approval"), through
 * `approveAndRecord` so every case ends in a real tool or a real refusal:
 * PGlite for the database, MSW for the image host, the resolver hook for DNS,
 * and a stub Blob store. No environment variable, no network.
 *
 * What would embarrass us (§10): the server downloading a URL research never
 * recorded; the cover saying "photo attached" when the download failed; an
 * unchosen background-removed copy lingering as a photo.
 */

const IMAGE_URL = "https://images.example.com/products/p1s-front.png";
const RANK_2_URL = "https://images.example.com/products/p1s-side.jpg";
const PAGE_URL = "https://example.com/p1s";

let db: Db;
let approver: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  audit.failing = false;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  db = await getDb();
  approver = (await seedUser({ email: "niti@cornell.edu", role: "admin" })).id;
});

afterEach(() => {
  audit.failing = false;
  resetDbForTests();
});

function fakeStore() {
  let n = 0;
  const store = {
    put: vi.fn(),
    putUpload: vi.fn(async (prefix: string, file: File, access: "public" | "private") => {
      n += 1;
      const pathname = `${prefix}${file.name}-${n}`;
      return { pathname, url: `https://store.${access}.blob.test/${pathname}` };
    }),
    copyToPublic: vi.fn(async (pathname: string, prefix: string) => {
      const name = pathname.slice(pathname.lastIndexOf("/") + 1);
      return { pathname: `${prefix}${name}-pub`, url: `https://store.public.blob.test/${prefix}${name}-pub` };
    }),
    read: vi.fn(async () => null),
    list: vi.fn(async () => []),
    del: vi.fn(async () => undefined),
  };
  return store as typeof store & BlobStore;
}

function research(images: ResearchImages | null, overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Bambu Lab P1S",
    description: "An enclosed FDM printer.",
    specs: [],
    materials: ["PLA"],
    ppeRequired: [],
    tags: [],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [],
    droppedLinks: [],
    sourceUrls: [PAGE_URL],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: false,
      specsFromSource: true,
      categoryOnly: false,
    },
    confidence: { level: "high", basis: [], unknowns: [] },
    images,
    ...overrides,
  };
}

function fields(image?: ApprovalFields["image"]): ApprovalFields {
  return {
    name: "Bambu Lab P1S",
    description: "An enclosed FDM printer.",
    categoryId: null,
    newCategory: { name: "FDM", group: "3D Printing" },
    locationId: null,
    materials: ["PLA"],
    ppeRequired: [],
    tags: [],
    trainingRequired: true,
    useRestrictions: null,
    serialNumber: null,
    ...(image ? { image } : {}),
  };
}

/**
 * An item researched the way the workflow leaves it: two candidates and a
 * private cleaned copy of rank 1 owned by the item, plus an uploaded photo
 * when asked for.
 */
async function researchedItem(
  options: {
    withCleaned?: boolean;
    withUpload?: boolean;
    overrides?: Partial<ResearchResult>;
    rank1Background?: ImageCandidate["background"];
  } = {}
): Promise<{ id: string; cleanedId: string | null; uploadId: string | null }> {
  let uploadId: string | null = null;
  if (options.withUpload) {
    const [upload] = await db
      .insert(attachments)
      .values({ blobPathname: "uploads/chat/front.jpg", access: "public", uploadedBy: approver, origin: "upload" })
      .returning({ id: attachments.id });
    uploadId = upload.id;
  }
  const batch = await createPendingBatch({
    createdBy: approver,
    items: [{ name: "Bambu Lab P1S", attachmentIds: uploadId ? [uploadId] : [] }],
  });
  const id = batch.items[0].id;

  let cleanedId: string | null = null;
  if (options.withCleaned !== false) {
    const [cleaned] = await db
      .insert(attachments)
      .values({
        blobPathname: "research/cleaned/p1s-front.png",
        access: "private",
        contentType: "image/png",
        origin: "research_image_cleaned",
        sourceUrl: IMAGE_URL,
        ownerType: "pending_tool",
        ownerId: id,
      })
      .returning({ id: attachments.id });
    cleanedId = cleaned.id;
  }

  const images: ResearchImages = {
    candidates: [
      {
        url: IMAGE_URL,
        pageUrl: PAGE_URL,
        source: "og",
        width: 1200,
        height: 900,
        contentType: "image/png",
        rank: 1,
        reason: "The printer, front on.",
        ...(options.rank1Background ? { background: options.rank1Background } : {}),
      },
      {
        url: RANK_2_URL,
        pageUrl: null,
        source: "exa",
        width: 800,
        height: 800,
        contentType: "image/jpeg",
        rank: 2,
        reason: "A side view.",
      },
    ],
    cleaned: cleanedId ? { attachmentId: cleanedId, fromUrl: IMAGE_URL } : null,
  };

  expect(await queueForResearch([id], { requestedBy: approver })).toEqual([id]);
  expect(await markResearching(id)).not.toBeNull();
  expect(await completeResearch(id, research(images, options.overrides))).toBe(true);
  return { id, cleanedId, uploadId };
}

/** The image host, answering `IMAGE_URL`; counts every request that reaches it. */
function imageHost(respond: () => Response = () => pngResponse()) {
  const hits: string[] = [];
  server.use(
    http.get("https://images.example.com/*", ({ request }) => {
      hits.push(request.url);
      return respond();
    })
  );
  return hits;
}

function pngResponse(): Response {
  return new HttpResponse(makePng({ width: 640, height: 480, alpha: false }), {
    headers: { "content-type": "image/png" },
  });
}

async function attachment(id: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row;
}

async function toolPhotos(toolId: string) {
  return db
    .select({
      id: attachments.id,
      position: attachments.position,
      origin: attachments.origin,
      access: attachments.access,
    })
    .from(attachments)
    .where(eq(attachments.ownerId, toolId))
    .orderBy(attachments.position);
}

async function pendingEvent(id: string) {
  const [event] = await db.select().from(auditEvents).where(eq(auditEvents.subjectId, id));
  return event;
}

describe("choice: original", () => {
  it("stores a recorded candidate public at the cover, with its source URL and dimensions", async () => {
    const hits = imageHost();
    const store = fakeStore();
    const { id, cleanedId, uploadId } = await researchedItem({ withUpload: true });

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: true });
    expect(result).not.toHaveProperty("warning");
    if (!result.ok) throw new Error("unreachable");
    expect(hits).toEqual([IMAGE_URL]);

    const [putPrefix, file, access] = store.putUpload.mock.calls[0];
    expect(putPrefix).toBe("uploads/tool/");
    expect(access).toBe("public");
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("p1s-front.png");

    const photos = await toolPhotos(result.toolId);
    expect(photos).toEqual([
      { id: expect.any(String), position: 0, origin: "research_image", access: "public" },
      { id: uploadId, position: 1, origin: "upload", access: "public" },
    ]);
    expect(await attachment(photos[0].id)).toMatchObject({
      sourceUrl: IMAGE_URL,
      width: 640,
      height: 480,
      contentType: "image/png",
      uploadedBy: approver,
      publicUrl: expect.stringContaining("https://store.public.blob.test/uploads/tool/"),
    });
    // The cleaned copy nobody chose is let go for the orphan sweep.
    expect(await attachment(cleanedId!)).toMatchObject({ ownerType: null, ownerId: null });
  });

  it("attaches an already transparent rank 1 as it is — the original is the clean version, alpha and all", async () => {
    const transparent = makePng({ width: 640, height: 480, alpha: true });
    const hits = imageHost(() => new HttpResponse(transparent, { headers: { "content-type": "image/png" } }));
    const store = fakeStore();
    const { id } = await researchedItem({ withCleaned: false, rank1Background: "transparent" });

    // Nothing to promote: there is no cleaned copy, so "cleaned" is not a choice.
    const refused = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "cleaned" }) },
      { store }
    );
    expect(refused).toMatchObject({ ok: false, error: "invalid_field" });

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: true });
    if (!result.ok) throw new Error("unreachable");
    expect(hits).toEqual([IMAGE_URL]);
    const [, file] = store.putUpload.mock.calls[0];
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(transparent);
    const photos = await toolPhotos(result.toolId);
    expect(photos).toEqual([{ id: expect.any(String), position: 0, origin: "research_image", access: "public" }]);
  });

  it("records the choice in the audit trail, and no URL", async () => {
    imageHost();
    const { id } = await researchedItem();

    await approveAndRecord(
      { userId: approver },
      { id, publish: false, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store: fakeStore() }
    );

    const event = await pendingEvent(id);
    expect(event.detail).toMatchObject({ image: { choice: "original", attached: true } });
    expect(JSON.stringify(event.detail)).not.toContain("example.com");
  });

  it("refuses a URL research never recorded as invalid_field, and fetches nothing", async () => {
    const hits = imageHost();
    const store = fakeStore();
    const { id } = await researchedItem();

    for (const candidateUrl of [
      "http://169.254.169.254/latest/meta-data/",
      `${IMAGE_URL}?x=1`,
      "https://images.example.com/products/other.png",
    ]) {
      const result = await approveAndRecord(
        { userId: approver },
        { id, publish: true, fields: fields({ choice: "original", candidateUrl }) },
        { store }
      );
      expect(result).toEqual({ ok: false, error: "invalid_field" });
    }

    expect(hits).toEqual([]);
    expect(store.putUpload).not.toHaveBeenCalled();
    expect(await db.select().from(tools)).toHaveLength(2); // the demo seed only
  });

  it("downloads nothing when the approval is going to be refused anyway", async () => {
    const hits = imageHost();
    const { id } = await researchedItem({
      overrides: { confidence: { level: "low", basis: [], unknowns: [] } },
    });

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store: fakeStore() }
    );

    expect(result).toEqual({ ok: false, error: "low_confidence" });
    expect(hits).toEqual([]);
  });

  it.each([
    ["answers 404", () => new HttpResponse("gone", { status: 404 })],
    [
      "is too large",
      () =>
        new HttpResponse(new Uint8Array(IMAGE_MAX_BYTES + 1), {
          headers: { "content-type": "image/png" },
        }),
    ],
    [
      "does not decode as an image",
      () => new HttpResponse("<html>not a picture</html>", { headers: { "content-type": "image/png" } }),
    ],
  ])("still creates the tool, with image_not_attached, when the image %s", async (_label, respond) => {
    imageHost(respond);
    const store = fakeStore();
    const { id } = await researchedItem();

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: false, warning: "image_not_attached" });
    if (!result.ok) throw new Error("unreachable");
    expect(await toolPhotos(result.toolId)).toEqual([]);
    expect(store.putUpload).not.toHaveBeenCalled();
    expect((await pendingEvent(id)).detail).toMatchObject({ image: { choice: "original", attached: false } });
  });

  it("refuses a recorded URL whose host now resolves inward, and still creates the tool", async () => {
    const hits = imageHost();
    setResolvedAddresses({ "images.example.com": ["10.0.0.7"] });
    const { id } = await researchedItem();

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store: fakeStore() }
    );

    expect(result).toMatchObject({ ok: true, warning: "image_not_attached" });
    expect(hits).toEqual([]);
  });

  it("takes the stored file back out when its row cannot be written", async () => {
    imageHost();
    const store = fakeStore();
    const { id } = await researchedItem();
    // A store that answers no pathname makes the row's insert fail
    // (`blob_pathname` is not null) after the bytes were written.
    store.putUpload.mockResolvedValueOnce({ pathname: null as unknown as string, url: "https://x.test/y" });

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, warning: "image_not_attached", imageAttached: false });
    expect(store.del).toHaveBeenCalledOnce();
  });
});

describe("choice: cleaned", () => {
  it("makes the cleaned copy public through copyToPublic and puts it at the cover", async () => {
    const hits = imageHost();
    const store = fakeStore();
    const { id, cleanedId, uploadId } = await researchedItem({ withUpload: true });

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "cleaned" }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: true });
    if (!result.ok) throw new Error("unreachable");
    expect(store.copyToPublic).toHaveBeenCalledExactlyOnceWith(
      "research/cleaned/p1s-front.png",
      "uploads/tool/"
    );
    expect(await toolPhotos(result.toolId)).toEqual([
      { id: cleanedId, position: 0, origin: "research_image_cleaned", access: "public" },
      { id: uploadId, position: 1, origin: "upload", access: "public" },
    ]);
    expect(hits).toEqual([]);
    expect((await pendingEvent(id)).detail).toMatchObject({ image: { choice: "cleaned", attached: true } });
  });

  it("is invalid_field when research recorded no cleaned copy", async () => {
    const { id } = await researchedItem({ withCleaned: false });

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "cleaned" }) },
      { store: fakeStore() }
    );

    expect(result).toEqual({ ok: false, error: "invalid_field" });
  });

  it("warns rather than attach a copy that is no longer the item's", async () => {
    const store = fakeStore();
    const { id, cleanedId } = await researchedItem();
    await db.update(attachments).set({ ownerType: null, ownerId: null }).where(eq(attachments.id, cleanedId!));

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "cleaned" }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: false, warning: "image_not_attached" });
    expect(store.copyToPublic).not.toHaveBeenCalled();
  });

  it("warns when the store refuses the copy, and the copy stays private", async () => {
    const store = fakeStore();
    store.copyToPublic.mockRejectedValueOnce(new Error("access denied"));
    const { id, cleanedId } = await researchedItem();

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "cleaned" }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: false, warning: "image_not_attached" });
    // Not the cover, so released with the other unchosen copies.
    expect(await attachment(cleanedId!)).toMatchObject({ access: "private", ownerId: null });
  });
});

describe("choice: none, and no Blob store", () => {
  it("none attaches nothing, releases the cleaned copy, and warns about nothing", async () => {
    const hits = imageHost();
    const store = fakeStore();
    const { id, cleanedId } = await researchedItem();

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "none" }) },
      { store }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: false });
    expect(result).not.toHaveProperty("warning");
    expect(hits).toEqual([]);
    expect(store.copyToPublic).not.toHaveBeenCalled();
    expect(await attachment(cleanedId!)).toMatchObject({ ownerType: null, ownerId: null });
    expect((await pendingEvent(id)).detail).toMatchObject({ image: { choice: "none", attached: false } });
  });

  it("an absent choice is none", async () => {
    const { id } = await researchedItem();
    const result = await approveAndRecord({ userId: approver }, { id, publish: false, fields: fields() });
    expect(result).toMatchObject({ ok: true, imageAttached: false });
    expect(result).not.toHaveProperty("warning");
  });

  it.each([
    ["original", { choice: "original", candidateUrl: IMAGE_URL }],
    ["cleaned", { choice: "cleaned" }],
  ] as const)("with no Blob store, %s still approves and says the image is missing", async (_label, image) => {
    const hits = imageHost();
    const { id } = await researchedItem();

    // No `store` option: the environment decides, and the suite has none.
    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields(image) }
    );

    expect(result).toMatchObject({ ok: true, imageAttached: false, warning: "image_not_attached" });
    expect(hits).toEqual([]);
  });

  it("gives the warning slot to a lost audit event, and still says the image is missing", async () => {
    imageHost(() => new HttpResponse(null, { status: 404 }));
    const { id } = await researchedItem();
    audit.failing = true;

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields({ choice: "original", candidateUrl: IMAGE_URL }) },
      { store: fakeStore() }
    );

    expect(result).toMatchObject({ ok: true, warning: "audit_unavailable", imageAttached: false });
  });
});
