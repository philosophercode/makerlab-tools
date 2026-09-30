// @vitest-environment node
import { eq } from "drizzle-orm";
import type { BlobStore } from "../blob";
import { createPgliteDb } from "../db/pglite";
import { attachments } from "../db/schema/index";
import type { Db } from "../db/types";
import { sharePhotosWithItems } from "./share-photo";

/**
 * One photo, several items (data platform spec amendment "Many items at
 * once"): each extra item gets its own public copy and row, never a second
 * pointer at the same bytes. Real Postgres in process; the Blob seam faked.
 */

let db: Db;
const ME = "user-me";
const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ITEM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function fakeStore(fail = false) {
  const store = {
    put: vi.fn(),
    putUpload: vi.fn(),
    read: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(undefined),
    copyToPublic: vi.fn(async (pathname: string, prefix: string) => {
      if (fail) throw new Error("blob down");
      const name = pathname.slice(pathname.lastIndexOf("/") + 1);
      return { pathname: `${prefix}${name}-copy`, url: `https://store.public.blob.vercel-storage.com/${prefix}${name}-copy` };
    }),
  };
  return store as typeof store & BlobStore;
}

/** A chat upload, already claimed by `owner` (the batch's first item). */
async function claimed(owner: string | null, uploadedBy = ME): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/chat/${crypto.randomUUID()}.jpg`,
      access: "private",
      contentType: "image/jpeg",
      originalFilename: "bench.jpg",
      origin: "upload",
      uploadedBy,
      ...(owner ? { ownerType: "pending_tool", ownerId: owner } : {}),
    })
    .returning({ id: attachments.id });
  return row.id;
}

async function ownedBy(owner: string) {
  return db.select().from(attachments).where(eq(attachments.ownerId, owner));
}

describe("sharePhotosWithItems", () => {
  it("gives each other item its own public copy, leaving the original with its first item", async () => {
    const bench = await claimed(ITEM_A);
    const store = fakeStore();

    const result = await sharePhotosWithItems(
      [
        { attachmentId: bench, ownerId: ITEM_B, position: 0 },
        { attachmentId: bench, ownerId: ITEM_C, position: 2 },
      ],
      { db, store, uploadedBy: ME, ownerIds: [ITEM_A, ITEM_B, ITEM_C] }
    );

    expect(result).toEqual({ shared: 2, failed: 0 });
    expect(store.copyToPublic).toHaveBeenCalledTimes(2);
    const [original] = await ownedBy(ITEM_A);
    expect(original.id).toBe(bench);
    const [b] = await ownedBy(ITEM_B);
    const [c] = await ownedBy(ITEM_C);
    expect(b).toMatchObject({ ownerType: "pending_tool", access: "public", origin: "upload", uploadedBy: ME, originalFilename: "bench.jpg", position: 0 });
    expect(c.position).toBe(2);
    expect(b.blobPathname).not.toBe(original.blobPathname);
    expect(b.publicUrl).toMatch(/^https:\/\/store\.public\.blob/);
  });

  it("never copies somebody else's upload", async () => {
    const theirs = await claimed(ITEM_A, "someone-else");
    const store = fakeStore();
    const result = await sharePhotosWithItems([{ attachmentId: theirs, ownerId: ITEM_B, position: 0 }], {
      db,
      store,
      uploadedBy: ME,
      ownerIds: [ITEM_A, ITEM_B],
    });
    expect(result).toEqual({ shared: 0, failed: 1 });
    expect(store.copyToPublic).not.toHaveBeenCalled();
  });

  it("never copies a photo no item of this batch holds", async () => {
    const loose = await claimed(null);
    const elsewhere = await claimed(ITEM_C);
    const store = fakeStore();
    const result = await sharePhotosWithItems(
      [
        { attachmentId: loose, ownerId: ITEM_B, position: 0 },
        { attachmentId: elsewhere, ownerId: ITEM_B, position: 1 },
      ],
      { db, store, uploadedBy: ME, ownerIds: [ITEM_A, ITEM_B] }
    );
    expect(result).toEqual({ shared: 0, failed: 2 });
    expect(await ownedBy(ITEM_B)).toHaveLength(0);
  });

  it("counts a failed copy and writes no row", async () => {
    const bench = await claimed(ITEM_A);
    const result = await sharePhotosWithItems([{ attachmentId: bench, ownerId: ITEM_B, position: 0 }], {
      db,
      store: fakeStore(true),
      uploadedBy: ME,
      ownerIds: [ITEM_A, ITEM_B],
    });
    expect(result).toEqual({ shared: 0, failed: 1 });
    expect(await ownedBy(ITEM_B)).toHaveLength(0);
  });

  it("fails every request when no Blob store is configured", async () => {
    const bench = await claimed(ITEM_A);
    const result = await sharePhotosWithItems([{ attachmentId: bench, ownerId: ITEM_B, position: 0 }], {
      db,
      uploadedBy: ME,
      ownerIds: [ITEM_A, ITEM_B],
    });
    expect(result).toEqual({ shared: 0, failed: 1 });
  });
});
