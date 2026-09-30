// @vitest-environment node
import { isNull } from "drizzle-orm";
import { Canvas } from "../test/images/synthetic";
import { createPgliteDb } from "../src/lib/db/pglite";
import { attachments, tools } from "../src/lib/db/schema/index";
import type { Db } from "../src/lib/db/types";
import type { ThumbnailIO } from "../src/lib/images/attachment-thumbnails";
import { parseArgs, runThumbnailBackfill } from "./backfill-thumbnails";

/**
 * `npm run thumbnails:backfill` against an in-process Postgres and an
 * in-memory store: dry run by default, `--apply` renders, only owned rows.
 */

let db: Db;
let photo: Uint8Array;

beforeAll(async () => {
  db = await createPgliteDb();
  photo = await new Canvas(700, 350).rect(100, 100, 500, 150, [10, 10, 10, 255]).png();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(tools);
});

function memoryIO(): ThumbnailIO & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    read: async () => photo,
    write: async (pathname) => {
      writes.push(pathname);
      return { url: `https://store.public.blob.vercel-storage.com/${pathname}` };
    },
  };
}

async function seed(): Promise<{ owned: string; unowned: string }> {
  const [tool] = await db.insert(tools).values({ slug: "saw", name: "Saw" }).returning({ id: tools.id });
  const rows = await db
    .insert(attachments)
    .values([
      { blobPathname: "uploads/tool/a.png", access: "public", publicUrl: "https://store.public.blob.vercel-storage.com/uploads/tool/a.png", contentType: "image/png", ownerType: "tool", ownerId: tool.id },
      { blobPathname: "uploads/tool/b.png", access: "public", publicUrl: "https://store.public.blob.vercel-storage.com/uploads/tool/b.png", contentType: "image/png" },
    ])
    .returning({ id: attachments.id });
  return { owned: rows[0].id, unowned: rows[1].id };
}

describe("parseArgs", () => {
  it("is a dry run unless --apply, and takes a positive --limit", () => {
    expect(parseArgs([])).toEqual({ apply: false });
    expect(parseArgs(["--apply", "--limit", "5"])).toEqual({ apply: true, limit: 5 });
    expect(parseArgs(["--apply", "--dry-run"])).toEqual({ apply: false });
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--force"])).toThrow(/Unknown argument/);
  });
});

describe("runThumbnailBackfill", () => {
  it("lists what it would render in a dry run, and writes nothing", async () => {
    const { owned } = await seed();
    const io = memoryIO();
    const lines: string[] = [];
    const report = await runThumbnailBackfill({ db, io, options: { apply: false }, log: (l) => lines.push(l) });
    expect(report).toEqual({ candidates: 1, written: [], failed: [] });
    expect(lines).toEqual([`would render ${owned} uploads/tool/a.png`]);
    expect(io.writes).toEqual([]);
    expect(await db.select().from(attachments).where(isNull(attachments.thumbnails))).toHaveLength(2);
  });

  it("renders owned images with --apply, leaving unclaimed uploads to the sweep", async () => {
    const { owned, unowned } = await seed();
    const io = memoryIO();
    const report = await runThumbnailBackfill({ db, io, options: { apply: true } });
    expect(report).toEqual({ candidates: 1, written: [owned], failed: [] });
    expect(io.writes).toHaveLength(6);
    const left = await db.select({ id: attachments.id }).from(attachments).where(isNull(attachments.thumbnails));
    expect(left.map((r) => r.id)).toEqual([unowned]);
  });

  it("refuses to apply without a store", async () => {
    await seed();
    await expect(runThumbnailBackfill({ db, io: null, options: { apply: true } })).rejects.toThrow(/No Blob store/);
  });
});
