// @vitest-environment node
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { createLocalBlobBackend } from "../blob-local";
import { getBulkImport } from "../data/bulk-imports";
import { listPendingTools } from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { DEMO_ACCOUNTS } from "../db/demo-seed";
import { attachments } from "../db/schema/index";
import { confirmImportMapping, startImport } from "./service";

/**
 * The import service (bulk intake spec §3.1, §5) against the demo-seeded
 * PGlite database: a table waits for its columns, a list becomes rows at once,
 * a document starts the reading workflow, and an uploaded file is read only
 * when it is the caller's own, unclaimed upload.
 */

const ADMIN = DEMO_ACCOUNTS.admin.id;
const RUN = crypto.randomUUID().slice(0, 6);

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterAll(() => {
  resetDbForTests();
});

const noRun = vi.fn(async () => ({ runId: "run-test" }));

describe("startImport", () => {
  it("a CSV waits in mapping, and Continue creates the rows through the confirmed map", async () => {
    const csv = `﻿Item,Make,Qty,SOP\n"Form 2, resin ${RUN}",Formlabs,2,https://docs.google.com/d/sop\nHeat gun ${RUN},Drill master,1,\n`;
    const started = await startImport({ userId: ADMIN, text: csv, sourceName: "inventory.csv", origin: "page", startRun: noRun });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.import).toMatchObject({ status: "mapping", format: "table", sourceKind: "paste" });
    expect(await listPendingTools({ importId: started.import.id })).toHaveLength(0);

    // Without a name column it will not continue.
    expect(await confirmImportMapping(started.import.id, [null, "brand", "quantity", "labDocs"])).toEqual({ ok: false, error: "no_name" });

    const confirmed = await confirmImportMapping(started.import.id, ["name", "brand", "quantity", "labDocs"]);
    expect(confirmed).toMatchObject({ ok: true, itemCount: 2 });
    const rows = await listPendingTools({ importId: started.import.id });
    const form2 = rows.find((row) => row.name.startsWith("Form 2"));
    expect(form2).toMatchObject({
      name: `Form 2, resin ${RUN}`,
      brand: "Formlabs",
      quantity: 2,
      status: "identified",
      labDocs: [{ title: "SOP", url: "https://docs.google.com/d/sop" }],
    });
    expect(await getBulkImport(started.import.id)).toMatchObject({ status: "ready", columnMap: ["name", "brand", "quantity", "labDocs"] });
  });

  it("from the chat, takes the suggested columns when they name the name column", async () => {
    const tsv = `Equipment\tQty\nBandsaw ${RUN}\t1\nLathe ${RUN}\t2\n`;
    const started = await startImport({ userId: ADMIN, text: tsv, origin: "chat", autoConfirm: true, startRun: noRun });
    expect(started.ok && started.import).toMatchObject({ status: "ready", itemCount: 2, sourceKind: "chat" });
  });

  it("a plain list becomes rows at once, with quantities as units", async () => {
    const started = await startImport({ userId: ADMIN, text: `- 3x Prusa MK4 ${RUN}\n- Form 2 ${RUN}\n- Drill master Heat Gun ${RUN}`, origin: "page", startRun: noRun });
    expect(started.ok && started.import).toMatchObject({ status: "ready", format: "list", itemCount: 3 });
    if (!started.ok) return;
    const prusa = (await listPendingTools({ importId: started.import.id })).find((row) => row.name.startsWith("Prusa"));
    expect(prusa?.quantity).toBe(3);
  });

  it("a document starts the reading workflow with its chunk count", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-doc" }));
    const prose = `The lab keeps a Trotec Speedy 400 ${RUN} in the laser room, serviced in March, and two older Glowforge units that students use for engraving and light cutting work.`;
    const started = await startImport({ userId: ADMIN, text: prose, origin: "page", startRun });
    expect(started.ok && started.import).toMatchObject({ status: "parsing", format: "document", workflowRunId: "run-doc" });
    if (!started.ok) return;
    expect(startRun).toHaveBeenCalledWith(started.import.id, 1);
  });

  it("says so when the reading workflow cannot start", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const prose = `A paragraph of prose about the ${RUN} lab and its equipment, long enough to be a document rather than a list of short entries.`;
    const started = await startImport({
      userId: ADMIN,
      text: prose,
      origin: "page",
      startRun: async () => {
        throw new Error("no world");
      },
    });
    expect(started.ok && started.import).toMatchObject({ status: "failed", parseError: "start_failed" });
  });

  it("refuses an empty list and one past the item limit", async () => {
    expect(await startImport({ userId: ADMIN, text: "   \n  ", origin: "page", startRun: noRun })).toEqual({ ok: false, error: "empty" });
    const rows = Array.from({ length: 1001 }, (_, i) => `Clamp ${i}\t1`).join("\n");
    expect(await startImport({ userId: ADMIN, text: `Item\tQty\n${rows}`, origin: "page", startRun: noRun })).toEqual({
      ok: false,
      error: "too_many_items",
      count: 1001,
      limit: 1000,
    });
    const lines = Array.from({ length: 1002 }, (_, i) => `- Clamp ${RUN} ${i}`).join("\n");
    expect(await startImport({ userId: ADMIN, text: lines, origin: "page", startRun: noRun })).toEqual({
      ok: false,
      error: "too_many_items",
      count: 1002,
      limit: 1000,
    });
  });

  it("refuses a document over the character limit before any model call, with its size in pages (amendment 2026-09-24)", async () => {
    const startRun = vi.fn(async () => ({ runId: "run-too-long" }));
    // About 85 pages of prose: 85 × 3,300 characters.
    const sentence = `The lab keeps a Trotec Speedy 400 ${RUN} in the laser room and services it every March for the students. `;
    const prose = sentence.repeat(Math.ceil((85 * 3_300) / sentence.length)).slice(0, 85 * 3_300);
    expect(await startImport({ userId: ADMIN, text: prose, origin: "page", startRun })).toEqual({
      ok: false,
      error: "document_too_long",
      pages: 85,
      limitPages: 60,
      limitChars: 200_000,
    });
    expect(startRun).not.toHaveBeenCalled();

    // Exactly at the limit is read whole — nothing is cut.
    const atLimit = prose.slice(0, 200_000);
    const started = await startImport({ userId: ADMIN, text: atLimit, origin: "page", startRun });
    expect(started.ok && started.import).toMatchObject({ status: "parsing", format: "document" });
    if (!started.ok) return;
    expect((await getBulkImport(started.import.id))?.sourceText).toHaveLength(200_000);
  });

  it("reads an uploaded list only when it is the caller's own unclaimed upload, and claims it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "import-blob-"));
    vi.stubEnv("BLOB_LOCAL_DISABLE", "");
    vi.stubEnv("BLOB_LOCAL_DIR", dir);
    const backend = createLocalBlobBackend(dir);
    const stored = await backend.put(`uploads/import/list-${RUN}.csv`, new TextEncoder().encode(`Item,Qty\nSpindle sander ${RUN},1\n`), {
      access: "private",
      contentType: "text/plain",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    expect((await readFile(join(dir, stored.pathname), "utf8")).length).toBeGreaterThan(0);

    const db = await getDb();
    const [mine] = await db
      .insert(attachments)
      .values({ blobPathname: stored.pathname, access: "private", contentType: "text/plain", originalFilename: "list.csv", uploadedBy: ADMIN })
      .returning({ id: attachments.id });

    // Somebody else typing the id gets nothing.
    expect(await startImport({ userId: DEMO_ACCOUNTS.superAdmin.id, attachmentId: mine.id, origin: "chat", startRun: noRun })).toEqual({
      ok: false,
      error: "file_not_found",
    });

    const started = await startImport({ userId: ADMIN, attachmentId: mine.id, origin: "page", startRun: noRun });
    expect(started.ok && started.import).toMatchObject({ status: "mapping", sourceKind: "csv", sourceName: "list.csv", sourceAttachmentId: mine.id });
    const [claimed] = await db.select().from(attachments).where(eq(attachments.id, mine.id));
    expect(claimed).toMatchObject({ ownerType: "bulk_import" });

    // Claimed now: a second import of the same id finds nothing to read.
    expect(await startImport({ userId: ADMIN, attachmentId: mine.id, origin: "page", startRun: noRun })).toEqual({ ok: false, error: "file_not_found" });
  });
});
