// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments } from "../db/schema/index";
import type { Db } from "../db/types";
import type { BlobStore } from "../blob";
import { promoteAttachmentsToPublic } from "./promote";

/**
 * Promoting a pending tool's photos from private to public, against a real
 * (in-process) Postgres with the Blob seam stubbed. No environment variable,
 * no network.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function fakeStore() {
  const store = {
    put: vi.fn(),
    putUpload: vi.fn(),
    copyToPublic: vi.fn(async (pathname: string, prefix: string) => {
      const name = pathname.slice(pathname.lastIndexOf("/") + 1);
      return {
        pathname: `${prefix}${name}-pub`,
        url: `https://store.public.blob.vercel-storage.com/${prefix}${name}-pub`,
      };
    }),
    list: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(undefined),
  };
  return store as typeof store & BlobStore;
}

async function upload(
  overrides: Partial<typeof attachments.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/chat/${crypto.randomUUID()}.jpg`,
      access: "private",
      ...overrides,
    })
    .returning({ id: attachments.id });
  return row.id;
}

async function stored(id: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row;
}

describe("promoteAttachmentsToPublic", () => {
  it("copies, repoints the row, then deletes the private original", async () => {
    const id = await upload({ blobPathname: "uploads/chat/plate.jpg" });
    const store = fakeStore();

    const result = await promoteAttachmentsToPublic([id], { db, store });

    expect(result).toEqual({ promoted: 1, failed: 0, skipped: 0 });
    expect(store.copyToPublic).toHaveBeenCalledWith("uploads/chat/plate.jpg", "uploads/tool/");
    const row = await stored(id);
    expect(row.access).toBe("public");
    expect(row.blobPathname).toBe("uploads/tool/plate.jpg-pub");
    expect(row.publicUrl).toBe(
      "https://store.public.blob.vercel-storage.com/uploads/tool/plate.jpg-pub"
    );
    expect(store.del).toHaveBeenCalledExactlyOnceWith(["uploads/chat/plate.jpg"]);
  });

  it("skips a row that is already public, and never copies it", async () => {
    const id = await upload({
      access: "public",
      publicUrl: "https://store.public.blob.vercel-storage.com/uploads/tool/x.jpg",
    });
    const store = fakeStore();

    const result = await promoteAttachmentsToPublic([id], { db, store });

    expect(result).toEqual({ promoted: 0, failed: 0, skipped: 1 });
    expect(store.copyToPublic).not.toHaveBeenCalled();
  });

  it("never marks a row public when the copy failed", async () => {
    const id = await upload({ blobPathname: "uploads/chat/plate.jpg" });
    const store = fakeStore();
    store.copyToPublic.mockRejectedValueOnce(new Error("copy refused"));

    const result = await promoteAttachmentsToPublic([id], { db, store });

    expect(result).toEqual({ promoted: 0, failed: 1, skipped: 0 });
    const row = await stored(id);
    expect(row.access).toBe("private");
    expect(row.blobPathname).toBe("uploads/chat/plate.jpg");
    expect(row.publicUrl).toBeNull();
    // The private original is still the only copy, so it must not be deleted.
    expect(store.del).not.toHaveBeenCalled();
  });

  it("still counts a photo promoted when only the old private blob could not be deleted", async () => {
    const id = await upload();
    const store = fakeStore();
    store.del.mockRejectedValueOnce(new Error("blob down"));

    const result = await promoteAttachmentsToPublic([id], { db, store });

    expect(result).toEqual({ promoted: 1, failed: 0, skipped: 0 });
    expect((await stored(id)).access).toBe("public");
  });

  it("takes the public copy back out when the row could not be repointed", async () => {
    const id = await upload({ blobPathname: "uploads/chat/plate.jpg" });
    const store = fakeStore();
    // The row goes away between the copy and the update — the orphan sweep,
    // say — so there is nothing left to mark.
    store.copyToPublic.mockImplementationOnce(async () => {
      await db.delete(attachments).where(eq(attachments.id, id));
      return { pathname: "uploads/tool/plate-pub.jpg", url: "https://x.public.blob.vercel-storage.com/plate-pub.jpg" };
    });

    const result = await promoteAttachmentsToPublic([id], { db, store });

    expect(result).toEqual({ promoted: 0, failed: 1, skipped: 0 });
    expect(store.del).toHaveBeenCalledExactlyOnceWith(["uploads/tool/plate-pub.jpg"]);
  });

  it("carries on past one bad photo", async () => {
    const bad = await upload({ blobPathname: "uploads/chat/bad.jpg" });
    const good = await upload({ blobPathname: "uploads/chat/good.jpg" });
    const store = fakeStore();
    store.copyToPublic.mockImplementation(async (pathname: string, prefix: string) => {
      if (pathname.endsWith("bad.jpg")) throw new Error("copy refused");
      return { pathname: `${prefix}good-pub.jpg`, url: "https://x.public.blob.vercel-storage.com/good-pub.jpg" };
    });

    const result = await promoteAttachmentsToPublic([bad, good], { db, store });

    expect(result).toEqual({ promoted: 1, failed: 1, skipped: 0 });
    expect((await stored(bad)).access).toBe("private");
    expect((await stored(good)).access).toBe("public");
  });

  it("skips ids that name no row", async () => {
    const store = fakeStore();
    const result = await promoteAttachmentsToPublic(
      [crypto.randomUUID(), "not-a-uuid"],
      { db, store }
    );
    expect(result).toEqual({ promoted: 0, failed: 0, skipped: 2 });
    expect(store.copyToPublic).not.toHaveBeenCalled();
  });

  it("skips everything when no Blob store is configured", async () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    const id = await upload();

    const result = await promoteAttachmentsToPublic([id], { db });

    expect(result).toEqual({ promoted: 0, failed: 0, skipped: 1 });
    expect((await stored(id)).access).toBe("private");
  });

  it("does nothing at all for an empty list", async () => {
    const store = fakeStore();
    expect(await promoteAttachmentsToPublic([], { db, store })).toEqual({
      promoted: 0,
      failed: 0,
      skipped: 0,
    });
  });
});
