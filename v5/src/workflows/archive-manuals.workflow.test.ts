import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { start } from "workflow/api";
import { server } from "../../test/msw/server";
import { getDb, resetDbForTests } from "../lib/db/client";
import { manualDocuments, manualPages, resources, tools } from "../lib/db/schema/index";
import { archiveManuals } from "./archive-manuals";

/**
 * `archiveManuals` in process under `@workflow/vitest` (manual text spec §10
 * "Workflow: archive → index runs once"): the real step bundle archives a
 * manual PDF served by MSW into a temporary local Blob folder, then the index
 * step reads it back and stores its text. A second run changes nothing.
 */

const LINK = "https://maker.test/acme-laser-40-manual.pdf";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("archiveManuals (in process)", () => {
  it("archives a manual and processes it into text, once", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_LOCAL_DISABLE", "");
    vi.stubEnv("BLOB_LOCAL_DIR", mkdtempSync(join(tmpdir(), "archive-manuals-wf-")));
    for (const method of ["info", "warn"] as const) vi.spyOn(console, method).mockImplementation(() => {});

    const pdf = new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals/outline.pdf")));
    server.use(http.get(LINK, () => HttpResponse.arrayBuffer(pdf.slice().buffer, { headers: { "content-type": "application/pdf" } })));

    const db = await getDb();
    const [tool] = await db.select({ id: tools.id }).from(tools).limit(1);
    const [resource] = await db
      .insert(resources)
      .values({ toolId: tool.id, title: "Acme Laser 40 manual", type: "Manual", url: LINK })
      .returning({ id: resources.id });

    const first = await (await start(archiveManuals, [[resource.id]])).returnValue;
    expect(first).toEqual({ archived: 1, skipped: 0, failed: 0, indexed: 1, indexFailed: 0 });

    const docs = await db.select().from(manualDocuments).where(eq(manualDocuments.toolId, tool.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: "Acme Laser 40 manual", status: "ready", pageCount: 4, outlineSource: "pdf" });
    expect(await db.select().from(manualPages).where(eq(manualPages.documentId, docs[0].id))).toHaveLength(4);

    const second = await (await start(archiveManuals, [[resource.id]])).returnValue;
    expect(second).toEqual({ archived: 0, skipped: 1, failed: 0, indexed: 0, indexFailed: 0 });
    expect(await db.select().from(manualDocuments).where(eq(manualDocuments.toolId, tool.id))).toHaveLength(1);
  });
});
