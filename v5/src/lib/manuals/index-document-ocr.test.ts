// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GatewayRateLimitError } from "@ai-sdk/gateway";
import { asc, eq } from "drizzle-orm";
import { manualSourceKey } from "../data/manual-archives";
import { listIndexablePdfs, listManualStates } from "../data/manual-documents";
import { markResourceManualsStale } from "../data/manual-chunks";
import { createPgliteDb } from "../db/pglite";
import { attachments, manualChunks, manualDocuments, manualPages, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { fakeEmbeddingTarget } from "../../../test/ai/fake-embeddings";
import { EXTRACTOR_VERSION } from "./extract";
import { indexResourceManuals } from "./index-document";
import { ocrManual, type OcrRunner } from "./ocr";
import type { StoredFileResult } from "./stored-bytes";
import type { PageTranscript } from "./transcribe";

/**
 * OCR in the index step (manual text spec phase 3): a scan is read when the
 * caller hands an OCR runner (the backfill) and stored `ready`, its pages
 * marked `ocr`; it is never read twice at one OCR version; its text survives a
 * re-extraction without OCR (the workflow's Re-process); and a failed reading
 * leaves it `no_text` for the next run. PGlite; the page drawing is real (the
 * `scanned-image.pdf` fixture), the model a stub.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals", name)));
const LINK = "https://maker.test/scan.pdf";
const KEY = "ocr-1:stub/ocr";

const PAGE_TEXT =
  "Replacing the nozzle. Heat the nozzle to 220 °C, then unscrew it with the supplied wrench while holding the " +
  "heater block. Part number 3401-038. Never touch the heater block while it is hot.";

let db: Db;
let resourceId: string;
let attachmentId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(tools);
  const [tool] = await db.insert(tools).values({ slug: "x2d", name: "X2D", published: true }).returning({ id: tools.id });
  const [resource] = await db
    .insert(resources)
    .values({ toolId: tool.id, title: "X2D scanned manual", type: "Manual", url: LINK })
    .returning({ id: resources.id });
  resourceId = resource.id;
  const [attachment] = await db
    .insert(attachments)
    .values({
      ownerType: "resource",
      ownerId: resourceId,
      blobPathname: "manuals/scan.pdf",
      access: "public",
      publicUrl: "https://blob.test/scan.pdf",
      contentType: "application/pdf",
      sourceKey: manualSourceKey(resourceId, LINK),
    })
    .returning({ id: attachments.id });
  attachmentId = attachment.id;
});

afterEach(() => vi.restoreAllMocks());

const read = async (): Promise<StoredFileResult> => ({ ok: true, bytes: fixture("scanned-image.pdf") });

/** An OCR runner over the real page drawing, with `transcribe` as the model. */
function runner(transcribe: (jpeg: Uint8Array, page: number) => Promise<PageTranscript>, key = KEY): OcrRunner & { run: ReturnType<typeof vi.fn> } {
  return { key, maxPages: 150, run: vi.fn((bytes: Uint8Array) => ocrManual(bytes, { transcribe })) };
}

const reads = (page: number): PageTranscript => ({
  text: `Nozzle\n${PAGE_TEXT} (page ${page})`,
  headings: [{ title: "Nozzle", level: 1 }],
  inputTokens: 800,
  outputTokens: 120,
  cost: 0.0004,
});

async function storedDocument() {
  const [doc] = await db.select().from(manualDocuments).where(eq(manualDocuments.attachmentId, attachmentId));
  const pages = doc
    ? await db.select().from(manualPages).where(eq(manualPages.documentId, doc.id)).orderBy(asc(manualPages.pageNumber))
    : [];
  return { doc, pages };
}

describe("indexResourceManuals with OCR", () => {
  it("reads a scan into a ready document, pages marked ocr, and builds its passages", async () => {
    const ocr = runner(async (_jpeg, page) => reads(page));
    const target = fakeEmbeddingTarget();
    const [outcome] = await indexResourceManuals(resourceId, { db, read, ocr, passages: { target } });

    expect(outcome).toMatchObject({
      status: "indexed",
      documentStatus: "ready",
      pageCount: 3,
      ocr: { status: "read", key: KEY, documentStatus: "ready", pagesRead: 2, pagesBlank: 1 },
      passages: { status: "built" },
    });
    const { doc, pages } = await storedDocument();
    expect(doc).toMatchObject({ status: "ready", ocrVersion: KEY, extractorVersion: EXTRACTOR_VERSION, outlineSource: "inferred" });
    expect(doc.outline).toEqual([{ title: "Nozzle", page: 1, level: 1 }]);
    expect(pages.map((p) => [p.pageNumber, p.source])).toEqual([
      [1, "ocr"],
      [2, "ocr"],
      [3, "text"],
    ]);
    const chunks = await db.select().from(manualChunks);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.pageStart >= 1 && chunk.pageEnd <= 2)).toBe(true);
    expect((await listManualStates(db, [resourceId])).get(resourceId)).toMatchObject({ state: "ready", ocr: true, searchable: true });
  });

  it("never reads a scan twice at one OCR version, and lists it again for a new one", async () => {
    const ocr = runner(async (_jpeg, page) => reads(page));
    await indexResourceManuals(resourceId, { db, read, ocr, passages: false });
    expect(await listIndexablePdfs(db, { missingVersion: EXTRACTOR_VERSION, ocrKey: KEY })).toEqual([]);

    const [again] = await indexResourceManuals(resourceId, { db, read, ocr, passages: false });
    expect(again).toMatchObject({ status: "skipped", reason: "already_indexed" });
    expect(ocr.run).toHaveBeenCalledTimes(1);

    // --force re-extracts, but the same OCR's text stands: no second reading.
    const [forced] = await indexResourceManuals(resourceId, { db, read, ocr, force: true, passages: false });
    expect(forced).toMatchObject({ status: "skipped", reason: "ocr_kept" });
    expect(ocr.run).toHaveBeenCalledTimes(1);

    // --force-ocr reads it again; so does a new OCR version or model.
    await indexResourceManuals(resourceId, { db, read, ocr, forceOcr: true, passages: false });
    expect(ocr.run).toHaveBeenCalledTimes(2);
    expect(await listIndexablePdfs(db, { missingVersion: EXTRACTOR_VERSION, ocrKey: "ocr-2:stub/ocr" })).toHaveLength(1);
  });

  it("keeps the OCR text when the workflow re-processes the scan without OCR", async () => {
    await indexResourceManuals(resourceId, { db, read, ocr: runner(async (_jpeg, page) => reads(page)), passages: { target: fakeEmbeddingTarget() } });
    const before = await storedDocument();

    await markResourceManualsStale(db, resourceId);
    const [outcome] = await indexResourceManuals(resourceId, { db, read, passages: { target: fakeEmbeddingTarget() } });

    expect(outcome).toMatchObject({ status: "skipped", reason: "ocr_kept", passages: { status: "built" } });
    const after = await storedDocument();
    expect(after.doc).toMatchObject({ status: "ready", ocrVersion: KEY, extractorVersion: EXTRACTOR_VERSION });
    expect(after.pages.map((p) => p.text)).toEqual(before.pages.map((p) => p.text));
  });

  it("stores a scan it could not read as no_text, without an OCR version, so the next run tries again", async () => {
    const failing = runner(async () => {
      throw new GatewayRateLimitError({ message: "slow down", statusCode: 429 });
    });
    const [outcome] = await indexResourceManuals(resourceId, { db, read, ocr: failing, passages: false });
    expect(outcome).toMatchObject({
      status: "indexed",
      documentStatus: "no_text",
      ocr: { status: "failed", kind: "rate_limited", transient: true },
    });
    expect((await storedDocument()).doc).toMatchObject({ status: "no_text", ocrVersion: null });
    expect(await listIndexablePdfs(db, { missingVersion: EXTRACTOR_VERSION, ocrKey: KEY })).toHaveLength(1);

    // Without OCR (the workflow), the stored scan is simply at this version.
    expect(await listIndexablePdfs(db, { missingVersion: EXTRACTOR_VERSION })).toEqual([]);
  });

  it("records a scan read with nothing legible, and does not read it again", async () => {
    const empty = runner(async () => ({ text: "", headings: [], inputTokens: 800, outputTokens: 3, cost: 0.0003 }));
    const [outcome] = await indexResourceManuals(resourceId, { db, read, ocr: empty, passages: false });
    expect(outcome).toMatchObject({ status: "indexed", documentStatus: "no_text", ocr: { status: "read", documentStatus: "no_text" } });
    expect((await storedDocument()).doc).toMatchObject({ status: "no_text", ocrVersion: KEY });
    expect(await listIndexablePdfs(db, { missingVersion: EXTRACTOR_VERSION, ocrKey: KEY })).toEqual([]);
  });

  it("calls no model on a dry run, and says how many pages OCR would read", async () => {
    const ocr = runner(async (_jpeg, page) => reads(page));
    const [outcome] = await indexResourceManuals(resourceId, { db, read, ocr, dryRun: true });
    expect(outcome).toMatchObject({ status: "indexed", documentStatus: "no_text", ocr: { status: "planned", pages: 3 } });
    expect(ocr.run).not.toHaveBeenCalled();
    expect((await storedDocument()).doc).toBeUndefined();
  });

  it("leaves a scan no_text when no OCR is handed over (the workflow)", async () => {
    const [outcome] = await indexResourceManuals(resourceId, { db, read, passages: false });
    expect(outcome).toMatchObject({ status: "indexed", documentStatus: "no_text" });
    expect(outcome.status === "indexed" && outcome.ocr).toBeFalsy();
  });
});
