// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments } from "../db/schema/index";
import type { Db } from "../db/types";
import { hasUploadedPhoto, recordCleanedImage, releaseCleanedImages } from "./research-images";

/**
 * The image stage's attachment rows against PGlite (gateway spec §4.2): what
 * counts as an uploaded photo, the cleaned copy's shape, and its release.
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

describe("hasUploadedPhoto", () => {
  it("counts a pending item's upload, and an old row with no origin, as an uploaded photo", async () => {
    const withUpload = crypto.randomUUID();
    const withOld = crypto.randomUUID();
    await file({ ...owned(withUpload), origin: "upload" });
    await file({ ...owned(withOld), origin: null });
    expect(await hasUploadedPhoto(db, withUpload)).toBe(true);
    expect(await hasUploadedPhoto(db, withOld)).toBe(true);
  });

  it("does not count a cleaned copy, another owner's upload, or an unowned upload", async () => {
    const pendingId = crypto.randomUUID();
    await file({ ...owned(pendingId), origin: "research_image_cleaned" });
    await file({ ownerType: "tool", ownerId: pendingId, origin: "upload" });
    await file({ ...owned(crypto.randomUUID()), origin: "upload" });
    await file({ origin: "upload" });
    expect(await hasUploadedPhoto(db, pendingId)).toBe(false);
  });

  it("answers false for an id that is not a uuid", async () => {
    expect(await hasUploadedPhoto(db, "not-a-uuid")).toBe(false);
  });
});

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
    expect(await hasUploadedPhoto(db, pendingId)).toBe(false);
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
