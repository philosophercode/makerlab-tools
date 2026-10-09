// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Canvas } from "../test/images/synthetic";
import { createPgliteDb } from "../src/lib/db/pglite";
import { attachments, tools } from "../src/lib/db/schema/index";
import type { Db } from "../src/lib/db/types";
import { recutToolCover, type RecutIO } from "../src/lib/images/recut-cover";
import { describeReport, parseArgs } from "./recut-tool-cover";

/**
 * `npm run images:recut` (gateway spec amendment "Thin margins and white
 * bezels"): the cutout run again on one tool's cover, against an in-process
 * Postgres and an in-memory store. The cover is the frame-filling tablet
 * fixture whose cut the old cutout never kept.
 */

const TABLET = new Uint8Array(readFileSync(join(__dirname, "../test/fixtures/cutout/spaceGreyThinMargin.jpg")));

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(tools);
});

function memoryIO(bytes: Uint8Array | null): RecutIO & { uploads: string[] } {
  const uploads: string[] = [];
  return {
    uploads,
    read: async () => bytes,
    upload: async (pathname) => {
      const stored = pathname.replace(/\.png$/, "-AbC123.png");
      uploads.push(stored);
      return { pathname: stored, url: `https://store.public.blob.vercel-storage.com/${stored}` };
    },
  };
}

async function toolWithCover(): Promise<{ toolId: string; coverId: string; secondId: string }> {
  const [tool] = await db.insert(tools).values({ slug: "ipad-6th-generation", name: "iPad 6th generation" }).returning({ id: tools.id });
  const rows = await db
    .insert(attachments)
    .values([
      {
        ownerType: "tool",
        ownerId: tool.id,
        position: 0,
        blobPathname: "uploads/tool/ipad-Xyz.webp",
        access: "public",
        publicUrl: "https://store.public.blob.vercel-storage.com/uploads/tool/ipad-Xyz.webp",
        contentType: "image/webp",
        origin: "research_image",
        sourceUrl: "https://shop.example/ipad.jpg",
      },
      {
        ownerType: "tool",
        ownerId: tool.id,
        position: 1,
        blobPathname: "uploads/tool/back.png",
        access: "public",
        publicUrl: "https://store.public.blob.vercel-storage.com/uploads/tool/back.png",
        contentType: "image/png",
      },
    ])
    .returning({ id: attachments.id });
  return { toolId: tool.id, coverId: rows[0].id, secondId: rows[1].id };
}

describe("parseArgs", () => {
  it("needs --tool, is a dry run unless --apply, and takes --out", () => {
    expect(parseArgs(["--tool", "ipad"])).toEqual({ tool: "ipad", apply: false, out: null });
    expect(parseArgs(["--tool", "ipad", "--apply", "--out", "cut.png"])).toEqual({ tool: "ipad", apply: true, out: "cut.png" });
    expect(() => parseArgs([])).toThrow(/--tool/);
    expect(() => parseArgs(["--tool", "--apply"])).toThrow(/--tool/);
    expect(() => parseArgs(["--tool", "x", "--force"])).toThrow(/Unknown argument/);
  });
});

describe("recutToolCover", () => {
  it("makes the cut in a dry run and writes nothing", async () => {
    const { coverId } = await toolWithCover();
    const io = memoryIO(TABLET);
    const report = await recutToolCover({ db, slugOrId: "ipad-6th-generation", apply: false, io });
    expect(report).toMatchObject({ status: "cut", kind: "cut", cover: { attachmentId: coverId } });
    expect(describeReport(report, false)).toContain("Dry run");
    expect(io.uploads).toEqual([]);
    const [cover] = await db.select().from(attachments).where(eq(attachments.id, coverId));
    expect(cover.ownerType).toBe("tool");
  });

  it("with apply, stores the cut as the cover in the old one's place and releases the old one", async () => {
    const { toolId, coverId, secondId } = await toolWithCover();
    const io = memoryIO(TABLET);
    const report = await recutToolCover({ db, slugOrId: toolId, apply: true, io });
    if (report.status !== "replaced") throw new Error(`expected replaced, got ${report.status}`);
    expect(io.uploads).toEqual(["uploads/tool/ipad-Xyz-cutout-AbC123.png"]);

    const owned = await db.select().from(attachments).where(eq(attachments.ownerId, toolId));
    const fresh = owned.find((row) => row.id === report.newAttachmentId);
    expect(fresh).toMatchObject({
      position: 0,
      access: "public",
      contentType: "image/png",
      origin: "research_image_cleaned",
      sourceUrl: "https://shop.example/ipad.jpg",
      blobPathname: "uploads/tool/ipad-Xyz-cutout-AbC123.png",
    });
    expect(owned.map((row) => row.id).sort()).toEqual([report.newAttachmentId, secondId].sort());
    const [old] = await db.select().from(attachments).where(eq(attachments.id, coverId));
    expect(old.ownerId).toBeNull();
  });

  it("leaves a cover it cannot cut alone, and says why", async () => {
    const { coverId } = await toolWithCover();
    // A dark backdrop: nothing light to remove.
    const busy = await new Canvas(400, 300, [30, 30, 30, 255]).rect(100, 80, 200, 140, [200, 30, 30, 255]).png();
    const io = memoryIO(busy);
    const report = await recutToolCover({ db, slugOrId: "ipad-6th-generation", apply: true, io });
    expect(report).toMatchObject({ status: "not_cut", note: "busy_background" });
    expect(io.uploads).toEqual([]);
    const [cover] = await db.select().from(attachments).where(eq(attachments.id, coverId));
    expect(cover.ownerType).toBe("tool");
  });

  it("answers no_tool, no_cover and unreadable", async () => {
    expect(await recutToolCover({ db, slugOrId: "nothing-here", apply: false, io: memoryIO(TABLET) })).toEqual({ status: "no_tool" });
    await db.insert(tools).values({ slug: "bare", name: "Bare Bench" });
    expect(await recutToolCover({ db, slugOrId: "bare", apply: false, io: memoryIO(TABLET) })).toMatchObject({ status: "no_cover" });
    await toolWithCover();
    expect(await recutToolCover({ db, slugOrId: "ipad-6th-generation", apply: false, io: memoryIO(null) })).toMatchObject({ status: "unreadable" });
  });
});
