// @vitest-environment node
import { eq } from "drizzle-orm";
import { Canvas } from "../../../test/images/synthetic";
import { createPgliteDb } from "../db/pglite";
import { attachments, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  ensureThumbnails,
  listThumbnailCandidates,
  thumbnailStem,
  writeAttachmentThumbnails,
  type ThumbnailIO,
} from "./attachment-thumbnails";
import { thumbnailBlobPathnames } from "./thumbnail-urls";

/**
 * Thumbnails for Blob images against a real (in-process) Postgres, with the
 * store faked in memory: no env, no network.
 */

const ORIGIN = "https://store.public.blob.vercel-storage.com";

let db: Db;
let photo: Uint8Array;

beforeAll(async () => {
  db = await createPgliteDb();
  photo = await new Canvas(1200, 900).rect(200, 200, 800, 500, [30, 30, 30, 255]).jpeg();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(tools);
});

/** A store holding `files` (original bytes by pathname) and recording every write. */
function fakeIO(files: Record<string, Uint8Array>) {
  const written = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const io: ThumbnailIO = {
    async read(row) {
      return files[row.blobPathname] ?? null;
    },
    async write(pathname, bytes, contentType) {
      written.set(pathname, { bytes, contentType });
      return { url: `${ORIGIN}/${pathname}` };
    },
  };
  return { io, written };
}

async function tool(): Promise<string> {
  const [row] = await db.insert(tools).values({ slug: `t-${crypto.randomUUID()}`, name: "A tool" }).returning({ id: tools.id });
  return row.id;
}

async function image(overrides: Partial<typeof attachments.$inferInsert> = {}): Promise<{ id: string; blobPathname: string }> {
  const blobPathname = `uploads/tool/IMG_${crypto.randomUUID().slice(0, 8)}.jpg`;
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname,
      access: "public",
      publicUrl: `${ORIGIN}/${blobPathname}`,
      contentType: "image/jpeg",
      ...overrides,
    })
    .returning({ id: attachments.id, blobPathname: attachments.blobPathname });
  return row;
}

describe("thumbnailStem", () => {
  it("files the set under thumbs/, beside the original's path, without its extension", () => {
    expect(thumbnailStem("uploads/tool/IMG_1-x9.jpg", "abc")).toBe("thumbs/uploads/tool/IMG_1-x9.abc");
    expect(thumbnailStem("uploads/tool/noext", "abc")).toBe("thumbs/uploads/tool/noext.abc");
  });
});

describe("writeAttachmentThumbnails", () => {
  it("renders, stores and records a Blob image's thumbnails", async () => {
    const row = await image();
    const { io, written } = fakeIO({ [row.blobPathname]: photo });

    const made = await writeAttachmentThumbnails({ ...row, publicUrl: `${ORIGIN}/${row.blobPathname}` }, { db, io });

    expect(made).not.toBeNull();
    expect(made!.widths).toEqual([160, 320, 640]);
    expect(made).toMatchObject({ width: 1200, height: 900 });
    expect(made!.base.startsWith(`${ORIGIN}/thumbs/${row.blobPathname.replace(/\.jpg$/, "")}.`)).toBe(true);
    expect([...written.keys()].sort()).toEqual(thumbnailBlobPathnames(made).sort());
    expect(written.get(thumbnailBlobPathnames(made)[0])?.contentType).toBe("image/avif");

    const [stored] = await db.select({ thumbnails: attachments.thumbnails }).from(attachments).where(eq(attachments.id, row.id));
    expect(stored.thumbnails).toEqual(made);
  });

  it("records nothing when the original cannot be read or decoded", async () => {
    const row = await image();
    const unreadable = await writeAttachmentThumbnails({ ...row, publicUrl: "x" }, { db, io: fakeIO({}).io });
    const undecodable = await writeAttachmentThumbnails(
      { ...row, publicUrl: "x" },
      { db, io: fakeIO({ [row.blobPathname]: new TextEncoder().encode("nope") }).io }
    );
    expect(unreadable).toBeNull();
    expect(undecodable).toBeNull();
    const [stored] = await db.select({ thumbnails: attachments.thumbnails }).from(attachments).where(eq(attachments.id, row.id));
    expect(stored.thumbnails).toBeNull();
  });

  it("records nothing when a write fails", async () => {
    const row = await image();
    const io: ThumbnailIO = {
      read: async () => photo,
      write: async () => {
        throw new Error("blob down");
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await writeAttachmentThumbnails({ ...row, publicUrl: "x" }, { db, io })).toBeNull();
    spy.mockRestore();
  });
});

describe("listThumbnailCandidates", () => {
  it("picks public Blob images with no thumbnails, and nothing else", async () => {
    const owner = await tool();
    const wanted = await image({ ownerType: "tool", ownerId: owner });
    await image({ access: "private", publicUrl: null });
    await image({ contentType: "application/pdf" });
    await image({ publicUrl: "/tool-images/Form%204.png" });
    await image({ thumbnails: { base: `${ORIGIN}/thumbs/x.1`, widths: [160], width: 10, height: 10 } });
    const unowned = await image();

    const all = await listThumbnailCandidates(db);
    expect(all.map((r) => r.id).sort()).toEqual([wanted.id, unowned.id].sort());
    expect((await listThumbnailCandidates(db, { ownedOnly: true })).map((r) => r.id)).toEqual([wanted.id]);
    expect((await listThumbnailCandidates(db, { owner: { ownerType: "tool", ownerId: owner } })).map((r) => r.id)).toEqual([wanted.id]);
    expect((await listThumbnailCandidates(db, { ids: [unowned.id] })).map((r) => r.id)).toEqual([unowned.id]);
    expect(await listThumbnailCandidates(db, { ids: [] })).toEqual([]);
  });
});

describe("ensureThumbnails", () => {
  it("does nothing, and touches no database, without a store", async () => {
    expect(await ensureThumbnails({ ids: ["whatever"] }, { io: null })).toEqual({ written: 0, failed: 0 });
  });

  it("renders every matching row and counts the ones that failed", async () => {
    const owner = await tool();
    const good = await image({ ownerType: "tool", ownerId: owner });
    await image({ ownerType: "tool", ownerId: owner }); // its bytes are missing from the store
    const { io } = fakeIO({ [good.blobPathname]: photo });

    expect(await ensureThumbnails({ owner: { ownerType: "tool", ownerId: owner } }, { db, io })).toEqual({ written: 1, failed: 1 });
    // Idempotent: the rendered row is no longer a candidate.
    expect(await ensureThumbnails({ owner: { ownerType: "tool", ownerId: owner } }, { db, io })).toEqual({ written: 0, failed: 1 });
  });
});
