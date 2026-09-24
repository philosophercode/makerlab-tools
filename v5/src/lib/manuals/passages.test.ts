// @vitest-environment node
import { APICallError } from "ai";
import { eq } from "drizzle-orm";
import { fakeEmbeddingTarget } from "../../../test/ai/fake-embeddings";
import { seedManual, seedTool } from "../../../test/manuals/seed";
import {
  countManualsByState,
  listDocumentsNeedingPassages,
  listToolManualsForChat,
  markResourceManualsStale,
} from "../data/manual-chunks";
import { listManualStates } from "../data/manual-documents";
import { createPgliteDb } from "../db/pglite";
import { attachments, manualChunks, manualDocuments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { CHUNKER_VERSION } from "./chunk";
import { EMBED_BATCH_SIZE } from "./embed";
import { buildDocumentPassages } from "./passages";

/**
 * Building a document's search passages (manual text spec §3.1 steps 4–6,
 * §3.4): idempotent on the chunker and embedding versions, batched ≤ 96 per
 * Gateway call, one transaction, failures as values with `transient` set only
 * for what a retry could fix — plus the readers built on the versions.
 */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(tools);
  toolId = await seedTool(db, { name: "Form 4" });
});

afterEach(() => vi.restoreAllMocks());

/** `n` pages, each its own outline section, so each makes one passage. */
function sectionedPages(n: number) {
  return {
    pages: Array.from({ length: n }, (_, i) => `Section ${i} text about step ${i} of the procedure, long enough to keep.`),
    outline: Array.from({ length: n }, (_, i) => ({ title: `Section ${i}`, page: i + 1, level: 1 })),
  };
}

describe("buildDocumentPassages", () => {
  it("chunks, embeds in batches of at most 96, writes, and records both versions", async () => {
    const seeded = await seedManual(db, { toolId, title: "Form 4 Manual", ...sectionedPages(200) });
    const target = fakeEmbeddingTarget({ costPerCall: 0.0001 });
    const outcome = await buildDocumentPassages(db, seeded.documentId, { target });
    expect(outcome).toMatchObject({ status: "built", chunks: 200, calls: 3 });
    expect(outcome.status === "built" && outcome.cost).toBeCloseTo(0.0003);
    expect(target.calls.map((batch) => batch.length)).toEqual([EMBED_BATCH_SIZE, EMBED_BATCH_SIZE, 8]);
    expect(target.calls[0][0]).toMatch(/^Form 4 — Form 4 Manual › Section 0\n\n/);

    const [doc] = await db.select().from(manualDocuments).where(eq(manualDocuments.id, seeded.documentId));
    expect(doc).toMatchObject({ chunkerVersion: CHUNKER_VERSION, embeddingModel: target.key });
    const chunks = await db.select().from(manualChunks).where(eq(manualChunks.documentId, seeded.documentId));
    expect(chunks).toHaveLength(200);
    expect(chunks[0]).toMatchObject({ toolId, pageStart: expect.any(Number) });
    expect(chunks[0].embedding).toHaveLength(512);
  });

  it("is a no-op at the same versions, and rebuilds when the embedding model changes", async () => {
    const seeded = await seedManual(db, { toolId, title: "Manual", ...sectionedPages(3) });
    const target = fakeEmbeddingTarget();
    await buildDocumentPassages(db, seeded.documentId, { target });
    expect(await buildDocumentPassages(db, seeded.documentId, { target })).toEqual({
      status: "skipped",
      documentId: seeded.documentId,
      reason: "up_to_date",
    });
    expect(target.calls).toHaveLength(1);

    const other = fakeEmbeddingTarget({ key: "fake/other-model@512" });
    expect(await listDocumentsNeedingPassages(db, { chunkerVersion: CHUNKER_VERSION, embeddingModel: other.key })).toHaveLength(1);
    expect((await buildDocumentPassages(db, seeded.documentId, { target: other })).status).toBe("built");
    expect(await listDocumentsNeedingPassages(db, { chunkerVersion: CHUNKER_VERSION, embeddingModel: other.key })).toEqual([]);
    expect(await db.select().from(manualChunks).where(eq(manualChunks.documentId, seeded.documentId))).toHaveLength(3);
  });

  it("chunks without embedding on a dry run, and skips a document that is not ready", async () => {
    const seeded = await seedManual(db, { toolId, title: "Manual", ...sectionedPages(4) });
    const target = fakeEmbeddingTarget();
    expect(await buildDocumentPassages(db, seeded.documentId, { target, dryRun: true })).toMatchObject({ status: "chunked", chunks: 4 });
    expect(target.calls).toEqual([]);
    const scan = await seedManual(db, { toolId, title: "Scan", pages: [""], status: "no_text" });
    expect(await buildDocumentPassages(db, scan.documentId, { target })).toMatchObject({ status: "skipped", reason: "not_ready" });
  });

  it("classifies failures: a rate limit or no answer is transient, bad credentials are not; nothing is written", async () => {
    const seeded = await seedManual(db, { toolId, title: "Manual", ...sectionedPages(2) });
    const rateLimited = fakeEmbeddingTarget({
      fail: () =>
        new APICallError({ message: "slow down", url: "https://g.test", requestBodyValues: {}, statusCode: 429, isRetryable: false }),
    });
    expect(await buildDocumentPassages(db, seeded.documentId, { target: rateLimited })).toMatchObject({
      status: "failed",
      kind: "rate_limited",
      transient: true,
    });
    const offline = fakeEmbeddingTarget({ fail: () => new TypeError("fetch failed") });
    expect(await buildDocumentPassages(db, seeded.documentId, { target: offline })).toMatchObject({ status: "failed", transient: true });
    const denied = fakeEmbeddingTarget({
      fail: () =>
        new APICallError({ message: "no", url: "https://g.test", requestBodyValues: {}, statusCode: 401, isRetryable: false }),
    });
    expect(await buildDocumentPassages(db, seeded.documentId, { target: denied })).toMatchObject({
      status: "failed",
      kind: "auth",
      transient: false,
    });
    const wrongSize = fakeEmbeddingTarget({ vectorFor: () => [1, 0, 0] });
    expect(await buildDocumentPassages(db, seeded.documentId, { target: wrongSize })).toMatchObject({
      status: "failed",
      kind: "dimensions",
      transient: false,
    });
    expect(await db.select().from(manualChunks)).toEqual([]);
    const [doc] = await db.select().from(manualDocuments).where(eq(manualDocuments.id, seeded.documentId));
    expect(doc.chunkerVersion).toBeNull();
  });
});

describe("the readers", () => {
  it("say Searchable only once passages exist, and count manuals by state", async () => {
    const ready = await seedManual(db, { toolId, title: "Ready", ...sectionedPages(2) });
    const pending = await seedManual(db, { toolId, title: "Pending", ...sectionedPages(1) });
    await seedManual(db, { toolId, title: "Scan", pages: [""], status: "no_text" });
    await seedManual(db, { toolId, title: "Broken", pages: [], status: "failed" });
    await buildDocumentPassages(db, ready.documentId, { target: fakeEmbeddingTarget() });

    const states = await listManualStates(db, [ready.resourceId, pending.resourceId]);
    expect(states.get(ready.resourceId)).toMatchObject({ state: "ready", searchable: true, pageCount: 2 });
    expect(states.get(pending.resourceId)).toMatchObject({ state: "ready", searchable: false });

    // A current PDF with no document yet is "processing".
    const [bare] = await db.insert(resources).values({ toolId, title: "Bare" }).returning({ id: resources.id });
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: bare.id,
      blobPathname: "bare.pdf",
      access: "public",
      publicUrl: "https://blob.test/bare.pdf",
      contentType: "application/pdf",
      origin: "upload",
    });

    expect(await countManualsByState(db)).toEqual({
      searchable: 1,
      textOnly: 1,
      noText: 1,
      failed: 1,
      processing: 1,
      pages: 2 + 1 + 1 + 0,
      passages: 2,
    });
  });

  it("list a tool's manuals for the chat with access applied", async () => {
    const pub = await seedManual(db, { toolId, title: "Public", ...sectionedPages(1) });
    const priv = await seedManual(db, { toolId, title: "SOP", access: "private", ...sectionedPages(1) });
    await buildDocumentPassages(db, pub.documentId, { target: fakeEmbeddingTarget() });
    await buildDocumentPassages(db, priv.documentId, { target: fakeEmbeddingTarget() });
    const visitor = await listToolManualsForChat(db, toolId, { includePrivate: false });
    expect(visitor.map((m) => [m.title, m.searchable, m.pdfUrl])).toEqual([["Public", true, pub.publicUrl]]);
    const staff = await listToolManualsForChat(db, toolId, { includePrivate: true });
    expect(staff.map((m) => m.title).sort()).toEqual(["Public", "SOP"]);
    expect(staff.find((m) => m.title === "SOP")?.outline).toEqual([{ title: "Section 0", page: 1, level: 1 }]);
  });

  it("mark a resource's manuals stale for re-processing without deleting anything", async () => {
    const seeded = await seedManual(db, { toolId, title: "Manual", ...sectionedPages(2) });
    await buildDocumentPassages(db, seeded.documentId, { target: fakeEmbeddingTarget() });
    expect(await markResourceManualsStale(db, seeded.resourceId)).toBe(1);
    const [doc] = await db.select().from(manualDocuments).where(eq(manualDocuments.id, seeded.documentId));
    expect(doc).toMatchObject({ extractorVersion: "reprocess", chunkerVersion: null, embeddingModel: null });
    expect(await db.select().from(manualChunks).where(eq(manualChunks.documentId, seeded.documentId))).toHaveLength(2);
    expect(await markResourceManualsStale(db, "not-a-uuid")).toBe(0);
  });
});
