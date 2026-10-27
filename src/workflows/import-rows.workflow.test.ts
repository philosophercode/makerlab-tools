import { start } from "workflow/api";
import { beginImportRows, createBulkImport, getBulkImport, writeImportSlice } from "../lib/data/bulk-imports";
import { listPendingTools } from "../lib/data/pending-tools";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { readImportRows } from "../lib/import/rows";
import { importRows } from "./import-rows";

/**
 * The in-process `@workflow/vitest` run of the background row writer (import
 * progress spec 2026-10-27 §3.2, §10 "Workflow"): a 60-row table the service
 * has begun and written one slice of is finished a slice a step, every row
 * written once, and the import ends `ready` with its counts.
 */

const RUN = crypto.randomUUID().slice(0, 6);

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("importRows (in process)", () => {
  it("writes the rest of the rows a slice at a time, each once", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    const text = `Item,Qty\n${Array.from({ length: 60 }, (_, i) => `Clamp ${RUN} no.${i + 1},1`).join("\n")}\n`;
    const created = await createBulkImport({
      createdBy: DEMO_ACCOUNTS.admin.id,
      sourceKind: "csv",
      format: "table",
      sourceName: `clamps-${RUN}.csv`,
      sourceText: text,
      status: "mapping",
    });
    const read = readImportRows({ ...created, columnMap: ["name", "quantity"] });
    if (!read) throw new Error("the table did not read");
    await beginImportRows(created.id, { ...read, columnMap: ["name", "quantity"] });
    // The service writes the first slice itself before starting the run.
    await writeImportSlice(created.id, read.items);

    const run = await start(importRows, [created.id]);
    expect(await run.returnValue).toEqual({ slices: 2, done: 60 });

    expect(await getBulkImport(created.id)).toMatchObject({ status: "ready", itemCount: 60, progress: { total: 60, done: 60 } });
    const rows = await listPendingTools({ importId: created.id, limit: null });
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map((row) => row.sourceRow)).size).toBe(60);
  });

  it("stops at once for an import that is no longer identifying", { timeout: 60_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    const created = await createBulkImport({
      createdBy: DEMO_ACCOUNTS.admin.id,
      sourceKind: "paste",
      format: "list",
      sourceName: null,
      sourceText: `Lathe ${RUN}`,
      status: "parsing",
    });
    const run = await start(importRows, [created.id]);
    expect(await run.returnValue).toEqual({ slices: 1, done: 0 });
    expect(await listPendingTools({ importId: created.id })).toHaveLength(0);
  });
});
