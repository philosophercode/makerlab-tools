// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments } from "../db/schema/index";
import type { Db } from "../db/types";
import { recordCleanedImage, recordUploadCutout, releaseCleanedImages } from "./research-images";

/**
 * The image stage's attachment rows against PGlite (gateway spec §4.2): the
 * cleaned copy's shape — research's, and an uploaded photo's cutout — and its
 * release.
 * `owner_id` is polymorphic with no foreign key, so a random uuid stands in for
 * the pending item.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
});

async function file(values: Partial<typeof attachments.$inferInsert>): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({ blobPathname: `uploads/${crypto.randomUUID()}.jpg`, access: "private", contentType: "image/jpeg", ...values })
    .returning({ id: attachments.id });
  return row.id;
}

async function read(id: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row;
}

const owned = (pendingId: string) => ({ ownerType: "pending_tool", ownerId: pendingId });

describe("recordCleanedImage", () => {
  it("records a private PNG owned by the pending item, with where it came from", async () => {
    const pendingId = crypto.randomUUID();
    const id = await recordCleanedImage(db, {
      pendingId,
      blobPathname: "research/cleaned/abc-xyz.png",
      sizeBytes: 1234,
      width: 1024,
      height: 1024,
      fromUrl: "https://maker.example/hero.jpg",
    });

    expect(await read(id)).toMatchObject({
      ownerType: "pending_tool",
      ownerId: pendingId,
      position: 0,
      access: "private",
      publicUrl: null,
      contentType: "image/png",
      blobPathname: "research/cleaned/abc-xyz.png",
      sizeBytes: 1234,
      width: 1024,
      height: 1024,
      origin: "research_image_cleaned",
      sourceUrl: "https://maker.example/hero.jpg",
      uploadedBy: null,
    });
  });

  it("writes nothing when the owner cannot be claimed", async () => {
    await expect(
      recordCleanedImage(db, {
        pendingId: "not-a-uuid",
        blobPathname: "research/cleaned/x.png",
        sizeBytes: 1,
        width: 1,
        height: 1,
        fromUrl: "https://maker.example/x.jpg",
      })
    ).rejects.toThrow(/could not be attached/);
    expect(await db.select().from(attachments)).toEqual([]);
  });
});

describe("recordUploadCutout", () => {
  it("records a public PNG owned by the pending item as its cleaned copy, with no source URL", async () => {
    const pendingId = crypto.randomUUID();
    const uploader = crypto.randomUUID();
    const id = await recordUploadCutout(db, {
      pendingId,
      blobPathname: "uploads/tool/front-background-removed-abc.png",
      publicUrl: "https://blob.example/uploads/tool/front-background-removed-abc.png",
      sizeBytes: 2048,
      width: 900,
      height: 700,
      uploadedBy: uploader,
      filename: "front-background-removed.png",
    });

    expect(await read(id)).toMatchObject({
      ownerType: "pending_tool",
      ownerId: pendingId,
      access: "public",
      publicUrl: "https://blob.example/uploads/tool/front-background-removed-abc.png",
      contentType: "image/png",
      origin: "research_image_cleaned",
      sourceUrl: null,
      uploadedBy: uploader,
      originalFilename: "front-background-removed.png",
      width: 900,
      height: 700,
    });
    // It is the item's cleaned copy: a later research or approval lets it go like any other.
    expect(await releaseCleanedImages(db, pendingId)).toBe(1);
  });

  it("writes nothing when the owner cannot be claimed", async () => {
    await expect(
      recordUploadCutout(db, {
        pendingId: "not-a-uuid",
        blobPathname: "uploads/tool/x.png",
        publicUrl: "https://blob.example/x.png",
        sizeBytes: 1,
        width: 1,
        height: 1,
        uploadedBy: null,
        filename: "x.png",
      })
    ).rejects.toThrow(/could not be attached/);
    expect(await db.select().from(attachments)).toEqual([]);
  });
});

describe("releaseCleanedImages", () => {
  it("releases only the item's cleaned copies, leaving its uploads and other items alone", async () => {
    const pendingId = crypto.randomUUID();
    const other = crypto.randomUUID();
    const cleaned = await file({ ...owned(pendingId), origin: "research_image_cleaned", position: 1 });
    const upload = await file({ ...owned(pendingId), origin: "upload" });
    const otherCleaned = await file({ ...owned(other), origin: "research_image_cleaned" });

    expect(await releaseCleanedImages(db, pendingId)).toBe(1);

    expect(await read(cleaned)).toMatchObject({ ownerType: null, ownerId: null, position: 0 });
    expect(await read(upload)).toMatchObject(owned(pendingId));
    expect(await read(otherCleaned)).toMatchObject(owned(other));
    expect(await releaseCleanedImages(db, pendingId)).toBe(0);
    expect(await releaseCleanedImages(db, "not-a-uuid")).toBe(0);
  });
});
