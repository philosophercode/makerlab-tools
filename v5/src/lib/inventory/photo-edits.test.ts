// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { listAttachmentsForOwner } from "../data/attachments";
import { readToolRevision } from "../data/tools";
import { createPgliteDb } from "../db/pglite";
import { attachments, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { attachPhotos, removePhoto, reorderPhotos } from "./photo-edits";

/**
 * The Photos section of the editor.
 *
 * Nothing here talks to Blob — the upload route already wrote the bytes and an
 * unowned `attachments` row, and removal leaves the bytes to the daily sweep —
 * so every one of these passes with `BLOB_READ_WRITE_TOKEN` unset, which is
 * also how production behaves when the store is not linked.
 */

let db: Db;
let toolId: string;
let otherToolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.mocked(revalidateTag).mockClear();
  await db.delete(attachments);
  await db.delete(tools);
  const rows = await db
    .insert(tools)
    .values([
      { slug: "form-4", name: "Form 4" },
      { slug: "trotec", name: "Trotec Speedy 400" },
    ])
    .returning({ id: tools.id });
  toolId = rows[0].id;
  otherToolId = rows[1].id;
});

async function context(id = toolId) {
  return { toolId: id, expectedRevision: (await readToolRevision(id, { db }))!, db };
}

/**
 * Push the tool's `updated_at` by hand.
 *
 * PGlite's clock is millisecond-resolution, so a write can land inside the same
 * millisecond as the token that was read and leave it still matching. Real
 * Postgres has microseconds and no such window — see `data/revision.ts`.
 */
async function stageToolForward(): Promise<void> {
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set updated_at = updated_at - interval '1 second'`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);
}

/** An uploaded-but-unattached photo, as `POST /api/uploads` leaves one. */
async function upload(): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/tool/${crypto.randomUUID()}.png`,
      access: "public",
      contentType: "image/png",
    })
    .returning({ id: attachments.id });
  return row.id;
}

async function order(id = toolId): Promise<string[]> {
  const rows = await listAttachmentsForOwner(db, { ownerType: "tool", ownerId: id });
  return rows.map((row) => row.id);
}

describe("attachPhotos", () => {
  it("attaches uploads and drops the catalogue cache", async () => {
    const first = await upload();
    const second = await upload();

    const result = await attachPhotos(await context(), [first, second]);

    expect(result).toMatchObject({ ok: true, photosSubmitted: 2, photosAttached: 2 });
    expect(await order()).toEqual([first, second]);
    expect(revalidateTag).toHaveBeenCalledWith("catalog", "minutes");
  });

  it("appends rather than taking over the cover", async () => {
    const cover = await upload();
    await attachPhotos(await context(), [cover]);
    const later = await upload();

    await attachPhotos(await context(), [later]);

    // `claimAttachments` numbers from zero, which would otherwise make the
    // newest upload the cover — a surprise nobody asked for.
    expect(await order()).toEqual([cover, later]);
  });

  it("says so when a photo did not stick", async () => {
    const real = await upload();

    const result = await attachPhotos(await context(), [real, crypto.randomUUID()]);

    expect(result).toMatchObject({
      ok: true,
      photosSubmitted: 2,
      photosAttached: 1,
      warning: "photos_not_attached",
    });
    // The swept id is not in the order — it is not a row anybody can claim.
    expect(await order()).toEqual([real]);
  });

  it("cannot annex another tool's photo", async () => {
    const theirs = await upload();
    await attachPhotos(await context(otherToolId), [theirs]);

    const result = await attachPhotos(await context(), [theirs]);

    expect(result).toMatchObject({ photosSubmitted: 1, photosAttached: 0 });
    expect(await order()).toEqual([]);
    expect(await order(otherToolId)).toEqual([theirs]);
  });

  it("refuses a stale token and attaches nothing", async () => {
    const stale = (await context()).expectedRevision;
    await attachPhotos({ toolId, expectedRevision: stale, db }, [await upload()]);
    await stageToolForward();

    const result = await attachPhotos({ toolId, expectedRevision: stale, db }, [await upload()]);

    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(await order()).toHaveLength(1);
  });
});

describe("reorderPhotos", () => {
  it("puts the named photo first, making it the cover", async () => {
    const first = await upload();
    const second = await upload();
    await attachPhotos(await context(), [first, second]);

    const result = await reorderPhotos(await context(), [second, first]);

    expect(result).toMatchObject({ ok: true, order: [second, first] });
    expect(await order()).toEqual([second, first]);
  });
});

describe("removePhoto", () => {
  it("takes the photo off the tool and promotes the next one to cover", async () => {
    const cover = await upload();
    const next = await upload();
    await attachPhotos(await context(), [cover, next]);

    const result = await removePhoto(await context(), cover);

    expect(result).toMatchObject({ ok: true, order: [next] });
    expect(await order()).toEqual([next]);
    // The row survives, unowned, for the daily sweep to collect bytes and row
    // in that order. Deleting it here would leave the blob invisible forever.
    const rows = await db.select().from(attachments);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.id === cover)).toMatchObject({
      ownerType: null,
      ownerId: null,
    });
  });

  it("refuses a photo that is not this tool's, and moves nothing", async () => {
    const theirs = await upload();
    await attachPhotos(await context(otherToolId), [theirs]);
    const before = (await context()).expectedRevision;

    const result = await removePhoto({ toolId, expectedRevision: before, db }, theirs);

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(await order(otherToolId)).toEqual([theirs]);
    expect(await readToolRevision(toolId, { db })).toBe(before);
  });
});
