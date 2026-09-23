// @vitest-environment node

/**
 * The daily cron's manual stage against PGlite: which manuals are due (Manual,
 * a link, no PDF copy of that link), the moving oldest-first window, and the
 * counts the route reports. Starting the workflow is mocked at `start.ts`.
 */

const starter = vi.hoisted(() => ({ startManualArchive: vi.fn() }));
vi.mock("../manuals/start", () => starter);

import { listManualsDueForArchive, manualSourceKey } from "../data/manual-archives";
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { MANUALS_PER_NIGHT, runManualArchiveBackfill } from "./manual-archive";

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  starter.startManualArchive.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(tools);
  const [tool] = await db.insert(tools).values({ slug: "p1s", name: "P1S" }).returning({ id: tools.id });
  toolId = tool.id;
});

/** `n` Manual resources, created a minute apart, oldest first. */
async function manuals(n: number, values: Partial<typeof resources.$inferInsert> = {}): Promise<string[]> {
  const base = Date.UTC(2026, 0, 1);
  const rows = await db
    .insert(resources)
    .values(
      Array.from({ length: n }, (_, i) => ({
        toolId,
        title: `Manual ${i}`,
        type: "Manual",
        url: `https://maker.test/m${i}.pdf`,
        createdAt: new Date(base + i * 60_000),
        ...values,
      }))
    )
    .returning({ id: resources.id });
  return rows.map((row) => row.id);
}

async function pdf(resourceId: string, sourceKey: string | null) {
  await db.insert(attachments).values({
    ownerType: "resource",
    ownerId: resourceId,
    blobPathname: `manuals/${resourceId}.pdf`,
    access: "public",
    publicUrl: `https://blob.test/${resourceId}.pdf`,
    contentType: "application/pdf",
    sourceKey,
  });
}

describe("listManualsDueForArchive", () => {
  it("picks Manuals with an http link and no PDF of that link, oldest first", async () => {
    const [archived, stale, uploaded, due] = await manuals(4);
    await pdf(archived, manualSourceKey(archived, "https://maker.test/m0.pdf"));
    await pdf(stale, manualSourceKey(stale, "https://maker.test/old.pdf"));
    await pdf(uploaded, null);
    await db.insert(resources).values([
      { toolId, title: "SOP", type: "SOP", url: "https://maker.test/sop.pdf" },
      { toolId, title: "No link", type: "manual", url: null },
      { toolId, title: "Placeholder", type: "Manual", url: "#" },
    ]);

    expect(await listManualsDueForArchive({ db, limit: 10, day: 0 })).toEqual({ due: 2, ids: [stale, due] });
  });

  it("moves the window each night and wraps, so every manual is tried", async () => {
    const ids = await manuals(5);

    expect((await listManualsDueForArchive({ db, limit: 2, day: 0 })).ids).toEqual([ids[0], ids[1]]);
    expect((await listManualsDueForArchive({ db, limit: 2, day: 1 })).ids).toEqual([ids[2], ids[3]]);
    expect((await listManualsDueForArchive({ db, limit: 2, day: 2 })).ids).toEqual([ids[4], ids[0]]);
  });
});

describe("runManualArchiveBackfill", () => {
  it("starts nothing and reports zeros when nothing is due", async () => {
    expect(await runManualArchiveBackfill({ db })).toEqual({ due: 0, queued: 0, failed: 0 });
    expect(starter.startManualArchive).not.toHaveBeenCalled();
  });

  it("hands at most ten manuals to one run and reports the counts", async () => {
    const ids = await manuals(12);

    expect(await runManualArchiveBackfill({ db, now: new Date(0) })).toEqual({ due: 12, queued: MANUALS_PER_NIGHT, failed: 0 });
    expect(starter.startManualArchive).toHaveBeenCalledTimes(1);
    expect(starter.startManualArchive).toHaveBeenCalledWith(ids.slice(0, MANUALS_PER_NIGHT));
  });

  it("counts a run that could not be started as failed", async () => {
    await manuals(1);
    starter.startManualArchive.mockResolvedValue(false);

    expect(await runManualArchiveBackfill({ db })).toEqual({ due: 1, queued: 0, failed: 1 });
  });
});
