// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manualSourceKey } from "../src/lib/data/manual-archives.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { attachments, manualChunks, manualDocuments, resources, tools } from "../src/lib/db/schema/index.ts";
import { fakeEmbeddingTarget } from "../test/ai/fake-embeddings.ts";
import type { Db } from "../src/lib/db/types.ts";
import type { StoredFileResult } from "../src/lib/manuals/stored-bytes.ts";
import {
  loadIndexTargets,
  loadPassageTargets,
  parseArgs,
  runIndexBackfill,
  runPassagesBackfill,
  summarise,
  summarisePassages,
} from "./index-manuals.ts";

/**
 * The manual-text backfill (manual text spec §5 "Backfill"): arguments, which
 * PDFs it takes, the dry run, and the report. PGlite in process; the Blob read
 * is a stub serving the fixture PDFs by pathname.
 */

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals", name)));

let db: Db;
let resourceIds: string[];

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(tools);
  const [tool] = await db.insert(tools).values({ slug: "acme", name: "Acme" }).returning({ id: tools.id });
  resourceIds = [];
  for (const name of ["outline.pdf", "scanned.pdf", "encrypted.pdf"]) {
    const url = `https://maker.test/${name}`;
    const [row] = await db.insert(resources).values({ toolId: tool.id, title: name, type: "Manual", url }).returning({ id: resources.id });
    resourceIds.push(row.id);
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: row.id,
      blobPathname: name,
      access: "public",
      publicUrl: `https://blob.test/${name}`,
      contentType: "application/pdf",
      sourceKey: manualSourceKey(row.id, url),
    });
  }
});

afterEach(() => vi.restoreAllMocks());

const read = async (pathname: string): Promise<StoredFileResult> => ({ ok: true, bytes: fixture(pathname) });

describe("parseArgs", () => {
  it("reads --dry-run, --force, --limit and --ids", () => {
    expect(parseArgs([])).toEqual({ dryRun: false, force: false, limit: null, ids: null, textOnly: false });
    const id = "675596a3-081a-41a5-88e2-91353a18f759";
    expect(parseArgs(["--dry-run", "--force", "--limit=3", "--ids", `${id}`])).toEqual({ dryRun: true, force: true, limit: 3, ids: [id], textOnly: false });
  });

  it("refuses a bad limit, a non-uuid id and an unknown flag", () => {
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--ids", "form-4"])).toThrow(/uuids/);
    expect(() => parseArgs(["--all"])).toThrow(/Unknown argument/);
  });
});

describe("runIndexBackfill", () => {
  it("reports every status and the pages, and writes nothing on a dry run", async () => {
    const pdfs = await loadIndexTargets(db, { ids: null, limit: null, force: false });
    expect(pdfs).toHaveLength(3);
    const lines: string[] = [];
    const report = await runIndexBackfill({ db, pdfs, dryRun: true, read, log: (line) => lines.push(line) });
    expect(report.counts).toEqual({ ready: 1, no_text: 1, failed: 1, skipped: 0, read_failed: 0 });
    expect(report.pages).toBe(7);
    // Rows inserted in one instant come back in id order, so match lines by content.
    expect(lines.some((line) => /^\[\d\/3\] resource [0-9a-f-]{36}: ready, 4 pages, 4 outline entries/.test(line))).toBe(true);
    expect(lines.some((line) => line.includes(": no_text (no_text_layer), 3 pages"))).toBe(true);
    expect(lines.some((line) => line.includes(": failed (encrypted), 0 pages"))).toBe(true);
    expect(summarise(report, true)).toMatch(/^Dry run — nothing written\. 3 PDF\(s\) processed in [\d.]+s: ready 1, no_text 1, failed 1; 7 pages\.$/);
    expect(await db.select().from(manualDocuments)).toEqual([]);
  });

  it("writes on a real run, then finds nothing left to do; --limit and --ids narrow it", async () => {
    expect(await loadIndexTargets(db, { ids: null, limit: 1, force: false })).toHaveLength(1);
    expect((await loadIndexTargets(db, { ids: [resourceIds[1]], limit: null, force: false })).map((p) => p.resourceId)).toEqual([resourceIds[1]]);

    const pdfs = await loadIndexTargets(db, { ids: null, limit: null, force: false });
    await runIndexBackfill({ db, pdfs, dryRun: false, read });
    expect(await db.select().from(manualDocuments)).toHaveLength(3);
    expect(await loadIndexTargets(db, { ids: null, limit: null, force: false })).toEqual([]);
    expect(await loadIndexTargets(db, { ids: null, limit: null, force: true })).toHaveLength(3);
  });

  it("stores text only, then chunks and embeds every ready document missing passages, reporting tokens and cost", async () => {
    const pdfs = await loadIndexTargets(db, { ids: null, limit: null, force: false });
    await runIndexBackfill({ db, pdfs, dryRun: false, read });
    expect(await db.select().from(manualChunks)).toEqual([]);

    const key = "fake/fake-embed@512";
    const options = { ids: null, limit: null, force: false };
    const documents = await loadPassageTargets(db, options, key);
    expect(documents).toHaveLength(1); // only the ready one; the scan and the encrypted file have no text

    const dry = await runPassagesBackfill({ db, documents, dryRun: true, target: fakeEmbeddingTarget() });
    expect(dry).toMatchObject({ chunked: 1, built: 0, tokens: 0, cost: null });
    expect(summarisePassages(dry, true)).toMatch(/^Passages \(dry run, nothing embedded\): 1 document\(s\), \d+ passages\.$/);

    const lines: string[] = [];
    const target = fakeEmbeddingTarget({ costPerCall: 0.0002 });
    const report = await runPassagesBackfill({ db, documents, dryRun: false, target, log: (line) => lines.push(line) });
    expect(report).toMatchObject({ built: 1, failed: 0 });
    expect(report.tokens).toBeGreaterThan(0);
    expect(report.cost).toBeCloseTo(0.0002);
    expect(lines[0]).toMatch(/passages, \d+ tokens, 1 call\(s\), cost \$0\.00020/);
    expect(summarisePassages(report, false)).toMatch(/^Passages: 1 document\(s\) built, \d+ passages, \d+ tokens, cost \$0\.00020 in/);
    expect(await loadPassageTargets(db, options, key)).toEqual([]);
    // A new embedding model makes every document stale again.
    expect(await loadPassageTargets(db, options, "fake/next-model@512")).toHaveLength(1);
  });

  it("counts an embedding failure and goes on", async () => {
    const pdfs = await loadIndexTargets(db, { ids: null, limit: null, force: false });
    await runIndexBackfill({ db, pdfs, dryRun: false, read });
    const documents = await loadPassageTargets(db, { ids: null, limit: null, force: false }, "fake/fake-embed@512");
    const report = await runPassagesBackfill({
      db,
      documents,
      dryRun: false,
      target: fakeEmbeddingTarget({ fail: () => new TypeError("fetch failed") }),
    });
    expect(report).toMatchObject({ built: 0, failed: 1 });
    expect(summarisePassages(report, false)).toContain("1 failed");
  });

  it("counts a PDF it could not read, and goes on", async () => {
    const pdfs = await loadIndexTargets(db, { ids: null, limit: null, force: false });
    const flaky = async (pathname: string): Promise<StoredFileResult> =>
      pathname === "scanned.pdf" ? { ok: false, reason: "missing", transient: false } : read(pathname);
    const report = await runIndexBackfill({ db, pdfs, dryRun: false, read: flaky });
    expect(report.counts).toEqual({ ready: 1, no_text: 0, failed: 1, skipped: 0, read_failed: 1 });
    expect(summarise(report, false)).toContain("not read 1");
  });
});
