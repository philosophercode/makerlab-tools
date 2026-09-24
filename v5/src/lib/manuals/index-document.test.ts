// @vitest-environment node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createLocalBlobBackend } from "../blob-local";
import { manualSourceKey } from "../data/manual-archives";
import {
  countManualDocuments,
  findStoredManualByUrl,
  findStoredManualForTool,
  listIndexablePdfs,
  listManualContentsForTool,
  listManualStates,
} from "../data/manual-documents";
import { createPgliteDb } from "../db/pglite";
import { attachments, manualDocuments, manualPages, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { EXTRACTOR_VERSION } from "./extract";
import { indexResourceManuals } from "./index-document";
import { readStoredFile, type StoredFileResult } from "./stored-bytes";

/**
 * Processing a stored manual into text (manual text spec §3.1, §4, §5), against
 * PGlite, with the Blob read stubbed to return the fixture PDFs — plus the
 * readers the editor, the tool page and research use.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals", name)));
const LINK = "https://maker.test/acme-manual.pdf";

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(tools);
  const [tool] = await db.insert(tools).values({ slug: "acme-40", name: "Acme Laser 40", published: true }).returning({ id: tools.id });
  toolId = tool.id;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

async function resource(values: Partial<typeof resources.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(resources)
    .values({ toolId, title: "Acme manual", type: "Manual", url: LINK, ...values })
    .returning({ id: resources.id });
  return row.id;
}

async function pdf(
  resourceId: string,
  values: Partial<typeof attachments.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      ownerType: "resource",
      ownerId: resourceId,
      blobPathname: `manuals/${resourceId}-${Math.random().toString(36).slice(2)}.pdf`,
      access: "public",
      publicUrl: `https://blob.test/${resourceId}.pdf`,
      contentType: "application/pdf",
      sourceKey: manualSourceKey(resourceId, LINK),
      origin: "manual_archive",
      sourceUrl: LINK,
      ...values,
    })
    .returning({ id: attachments.id });
  return row.id;
}

/** A Blob read that answers every pathname with `bytes`. */
const serve = (bytes: Uint8Array) => vi.fn(async (): Promise<StoredFileResult> => ({ ok: true, bytes }));

describe("indexResourceManuals", () => {
  it("stores the document and its pages in one go, with the resource's title and tool", async () => {
    const id = await resource();
    const attachmentId = await pdf(id);
    const read = serve(fixture("outline.pdf"));

    const [outcome] = await indexResourceManuals(id, { db, read });
    expect(outcome).toMatchObject({ status: "indexed", attachmentId, documentStatus: "ready", pageCount: 4, outlineEntries: 4 });
    expect(read).toHaveBeenCalledWith(expect.stringMatching(/^manuals\//), "public", 25 * 1024 * 1024);

    const [doc] = await db.select().from(manualDocuments).where(eq(manualDocuments.attachmentId, attachmentId));
    expect(doc).toMatchObject({
      toolId,
      title: "Acme manual",
      status: "ready",
      pageCount: 4,
      outlineSource: "pdf",
      extractorVersion: EXTRACTOR_VERSION,
      embeddingModel: null,
    });
    expect(doc.outline[2]).toEqual({ title: "Electrical", page: 3, level: 2 });
    const pages = await db.select().from(manualPages).where(eq(manualPages.documentId, doc.id));
    expect(pages).toHaveLength(4);
  });

  it("is idempotent on the attachment and extractor version, and --force re-processes in place", async () => {
    const id = await resource();
    await pdf(id);
    const read = serve(fixture("outline.pdf"));
    await indexResourceManuals(id, { db, read });
    const [again] = await indexResourceManuals(id, { db, read });
    expect(again).toMatchObject({ status: "skipped", reason: "already_indexed" });
    expect(read).toHaveBeenCalledTimes(1);

    const [before] = await db.select({ id: manualDocuments.id }).from(manualDocuments);
    const [forced] = await indexResourceManuals(id, { db, read, force: true });
    expect(forced.status).toBe("indexed");
    const docs = await db.select({ id: manualDocuments.id }).from(manualDocuments);
    expect(docs).toEqual([before]);
    expect(await db.select().from(manualPages)).toHaveLength(4);
  });

  it("re-processes a document stored by an older extractor", async () => {
    const id = await resource();
    await pdf(id);
    await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")) });
    await db.update(manualDocuments).set({ extractorVersion: "unpdf-0/extract-0" });
    const [outcome] = await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")) });
    expect(outcome.status).toBe("indexed");
  });

  it("stores a scan as no_text and a corrupt file as failed — both answers, never retried", async () => {
    const scan = await resource({ title: "Scan" });
    await pdf(scan);
    const bad = await resource({ title: "Bad", url: "https://maker.test/bad.pdf" });
    await pdf(bad, { sourceKey: manualSourceKey(bad, "https://maker.test/bad.pdf") });

    expect((await indexResourceManuals(scan, { db, read: serve(fixture("scanned.pdf")) }))[0]).toMatchObject({
      status: "indexed",
      documentStatus: "no_text",
      reason: "no_text_layer",
    });
    expect((await indexResourceManuals(bad, { db, read: serve(fixture("corrupt.pdf")) }))[0]).toMatchObject({
      status: "indexed",
      documentStatus: "failed",
      reason: "corrupt",
    });
    // Stored, so a second run leaves them alone.
    expect((await indexResourceManuals(scan, { db, read: serve(fixture("scanned.pdf")) }))[0].status).toBe("skipped");
    expect(await countManualDocuments(db)).toEqual({ ready: 0, no_text: 1, failed: 1, pages: 3 });
  });

  it("records an over-size file as failed, and a Blob read that failed as a (transient) failure with nothing stored", async () => {
    const id = await resource();
    await pdf(id);
    const tooLarge = vi.fn(async (): Promise<StoredFileResult> => ({ ok: false, reason: "too_large", transient: false }));
    expect((await indexResourceManuals(id, { db, read: tooLarge }))[0]).toMatchObject({ documentStatus: "failed", reason: "too_large" });

    const other = await resource({ title: "Other", url: "https://maker.test/o.pdf" });
    await pdf(other, { sourceKey: manualSourceKey(other, "https://maker.test/o.pdf") });
    const down = vi.fn(async (): Promise<StoredFileResult> => ({ ok: false, reason: "failed", transient: true }));
    expect((await indexResourceManuals(other, { db, read: down }))[0]).toMatchObject({ status: "failed", reason: "read_failed", transient: true });
    const missing = vi.fn(async (): Promise<StoredFileResult> => ({ ok: false, reason: "missing", transient: false }));
    expect((await indexResourceManuals(other, { db, read: missing }))[0]).toMatchObject({ status: "failed", transient: false });
    expect(await db.select().from(manualDocuments).where(eq(manualDocuments.title, "Other"))).toEqual([]);
  });

  it("processes a staff-uploaded PDF, reads a private one as private, and never a stale archive copy", async () => {
    const id = await resource({ url: "https://maker.test/new-link.pdf" });
    await pdf(id); // an archive of the *old* link: stale
    const uploaded = await pdf(id, { sourceKey: null, origin: "upload", access: "private", publicUrl: null });
    const read = serve(fixture("outline.pdf"));

    const outcomes = await indexResourceManuals(id, { db, read });
    expect(outcomes.map((o) => o.attachmentId)).toEqual([uploaded]);
    expect(read).toHaveBeenCalledWith(expect.any(String), "private", expect.any(Number));
  });

  it("writes nothing on a dry run", async () => {
    const id = await resource();
    await pdf(id);
    const [outcome] = await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")), dryRun: true });
    expect(outcome).toMatchObject({ status: "indexed", documentStatus: "ready" });
    expect(await db.select().from(manualDocuments)).toEqual([]);
  });

  it("answers nothing for a resource with no PDF, or an id that is not one", async () => {
    expect(await indexResourceManuals(await resource({ url: null }), { db })).toEqual([]);
    expect(await indexResourceManuals("not-a-uuid", { db })).toEqual([]);
  });

  it("goes when its attachment goes", async () => {
    const id = await resource();
    const attachmentId = await pdf(id);
    await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")) });
    await db.delete(attachments).where(eq(attachments.id, attachmentId));
    expect(await db.select().from(manualDocuments)).toEqual([]);
    expect(await db.select().from(manualPages)).toEqual([]);
  });
});

describe("the readers", () => {
  it("gives the editor each resource's state: processing before, the stored state after", async () => {
    const id = await resource();
    await pdf(id);
    const none = await resource({ title: "Video", url: "https://video.test/x" });
    expect(await listManualStates(db, [id, none])).toEqual(new Map([[id, { state: "processing", pageCount: null, reason: null }]]));
    await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")) });
    expect((await listManualStates(db, [id])).get(id)).toEqual({ state: "ready", pageCount: 4, reason: null });
  });

  it("gives the tool page the outline of public, published, ready manuals only", async () => {
    const shown = await resource();
    await pdf(shown);
    const hidden = await resource({ title: "Hidden", published: false, url: "https://maker.test/h.pdf" });
    await pdf(hidden, { sourceKey: manualSourceKey(hidden, "https://maker.test/h.pdf"), publicUrl: "https://blob.test/h.pdf" });
    const priv = await resource({ title: "Private SOP", url: null });
    await pdf(priv, { sourceKey: null, access: "private", publicUrl: null });
    for (const id of [shown, hidden, priv]) await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")) });

    const contents = await listManualContentsForTool(db, toolId);
    expect(contents).toHaveLength(1);
    expect(contents[0].href).toBe(`https://blob.test/${shown}.pdf`);
    expect(contents[0].outline.map((e) => e.title)).toEqual(["Introduction", "Specifications", "Electrical", "Maintenance"]);
  });

  it("finds a stored manual for research by its source link, its stored copy, or its tool", async () => {
    const id = await resource();
    await pdf(id);
    await indexResourceManuals(id, { db, read: serve(fixture("outline.pdf")) });
    const byLink = await findStoredManualByUrl(db, LINK);
    expect(byLink?.pages).toHaveLength(4);
    expect(byLink?.outline).toHaveLength(4);
    expect((await findStoredManualByUrl(db, `https://blob.test/${id}.pdf`))?.documentId).toBe(byLink?.documentId);
    expect((await findStoredManualForTool(db, toolId))?.documentId).toBe(byLink?.documentId);
    expect(await findStoredManualByUrl(db, "https://maker.test/other.pdf")).toBeNull();
    expect(await findStoredManualByUrl(db, "not a url")).toBeNull();
  });

  it("lists what the backfill should process: missing or older documents, by resource, up to a limit", async () => {
    const a = await resource({ title: "A" });
    await pdf(a);
    const b = await resource({ title: "B", url: "https://maker.test/b.pdf" });
    await pdf(b, { sourceKey: manualSourceKey(b, "https://maker.test/b.pdf") });
    await indexResourceManuals(a, { db, read: serve(fixture("outline.pdf")) });

    expect((await listIndexablePdfs(db, { missingVersion: EXTRACTOR_VERSION })).map((p) => p.resourceId)).toEqual([b]);
    expect(await listIndexablePdfs(db)).toHaveLength(2);
    expect(await listIndexablePdfs(db, { limit: 1 })).toHaveLength(1);
    expect((await listIndexablePdfs(db, { resourceIds: [a] })).map((p) => p.resourceId)).toEqual([a]);
    expect(await listIndexablePdfs(db, { resourceIds: ["nope"] })).toEqual([]);
  });
});

describe("readStoredFile", () => {
  it("reads the local store in development, and says when there is none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "manual-bytes-"));
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_LOCAL_DISABLE", "");
    vi.stubEnv("BLOB_LOCAL_DIR", dir);
    const stored = await createLocalBlobBackend(dir).put("manuals/x.pdf", fixture("outline.pdf"), {
      access: "public",
      contentType: "application/pdf",
    });
    const read = await readStoredFile(stored.pathname, "public", 25 * 1024 * 1024);
    expect(read.ok && read.bytes.byteLength).toBe(fixture("outline.pdf").byteLength);
    expect(await readStoredFile(stored.pathname, "public", 10)).toEqual({ ok: false, reason: "too_large", transient: false });
    expect(await readStoredFile("manuals/none.pdf", "public", 100)).toEqual({ ok: false, reason: "missing", transient: false });

    vi.stubEnv("BLOB_LOCAL_DISABLE", "1");
    vi.stubEnv("BLOB_LOCAL_DIR", "");
    expect(await readStoredFile(stored.pathname, "public", 100)).toEqual({ ok: false, reason: "not_configured", transient: false });
  });
});
