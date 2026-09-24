// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments, projects } from "../db/schema/index";
import type { Db } from "../db/types";
import type { BlobStore } from "../blob";
import { runCleanup } from "./cleanup";

/**
 * Orphaned-upload cleanup against a real (in-process) Postgres, with the Blob
 * seam stubbed. No environment variable, no network.
 */

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-09-20T12:00:00.000Z");

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(projects);
});

function fakeStore() {
  const store = {
    put: vi.fn(),
    putUpload: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(undefined),
  };
  return store as typeof store & BlobStore;
}

async function upload(
  ageHours: number,
  overrides: Partial<typeof attachments.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/chat/${crypto.randomUUID()}.png`,
      access: "private",
      createdAt: new Date(NOW.getTime() - ageHours * HOUR),
      ...overrides,
    })
    .returning({ id: attachments.id });
  return row.id;
}

async function ownerRow(): Promise<string> {
  const [row] = await db
    .insert(projects)
    .values({ slug: `p-${crypto.randomUUID()}`, title: "A project" })
    .returning({ id: projects.id });
  return row.id;
}

async function exists(id: string): Promise<boolean> {
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(eq(attachments.id, id));
  return rows.length > 0;
}

describe("runCleanup", () => {
  it("deletes an unclaimed upload older than 24 hours from both Blob and Postgres", async () => {
    const store = fakeStore();
    const stale = await upload(25);

    const result = await runCleanup(store, { db, now: NOW });

    expect(result).toEqual({ orphans: 1, blobsDeleted: 1, rowsDeleted: 1 });
    expect(store.del).toHaveBeenCalledTimes(1);
    expect(await exists(stale)).toBe(false);
  });

  it("leaves a recent unclaimed upload alone", async () => {
    const store = fakeStore();
    // A half-finished submission left open over lunch must still be able to
    // submit its photos.
    const fresh = await upload(1);

    const result = await runCleanup(store, { db, now: NOW });

    expect(result.orphans).toBe(0);
    expect(store.del).not.toHaveBeenCalled();
    expect(await exists(fresh)).toBe(true);
  });

  it("never touches a claimed file, however old it is", async () => {
    const store = fakeStore();
    const projectId = await ownerRow();
    const owned = await upload(24 * 365, {
      ownerType: "project",
      ownerId: projectId,
    });

    await runCleanup(store, { db, now: NOW });

    // That file is somebody's record. Age is not a reason to delete it.
    expect(store.del).not.toHaveBeenCalled();
    expect(await exists(owned)).toBe(true);
  });

  it("deletes the blob before the row, so a failure cannot orphan the bytes", async () => {
    const store = fakeStore();
    const stale = await upload(48);
    store.del.mockRejectedValueOnce(new Error("blob down"));

    await expect(runCleanup(store, { db, now: NOW })).rejects.toThrow(
      "blob down"
    );

    // The row survives, so the next run finds the file again. The opposite
    // order would leave bytes nothing can ever address.
    expect(await exists(stale)).toBe(true);
  });

  it("asks the store nothing when there is nothing to sweep", async () => {
    const store = fakeStore();

    expect(await runCleanup(store, { db, now: NOW })).toEqual({
      orphans: 0,
      blobsDeleted: 0,
      rowsDeleted: 0,
    });
    expect(store.del).not.toHaveBeenCalled();
  });
});
