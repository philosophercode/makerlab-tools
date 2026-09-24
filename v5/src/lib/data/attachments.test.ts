// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { attachments, projects } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  claimAttachments,
  createAttachment,
  deleteAttachments,
  findAttachmentsByIds,
  listAttachmentsForOwner,
  listOrphanedAttachments,
  releaseAttachments,
  reorderAttachments,
} from "./attachments";

/**
 * Ownership claiming against a real (in-process) Postgres. No env, no network.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(projects);
});

/** An uploaded-but-unattached file, as `POST /api/uploads` will leave one. */
async function upload(
  overrides: Partial<typeof attachments.$inferInsert> = {}
): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/${crypto.randomUUID()}.png`,
      access: "public",
      contentType: "image/png",
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

async function readAttachment(id: string) {
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row;
}

describe("claimAttachments", () => {
  it("stamps the owner and the caller's order onto each file", async () => {
    const projectId = await ownerRow();
    const first = await upload();
    const second = await upload();

    const claimed = await claimAttachments(db, [second, first], {
      ownerType: "project",
      ownerId: projectId,
    });

    expect(claimed).toBe(2);
    // Position follows the order the ids were given, not insertion order —
    // the first photo in the list is the cover (§4.10).
    expect(await readAttachment(second)).toMatchObject({
      ownerType: "project",
      ownerId: projectId,
      position: 0,
    });
    expect(await readAttachment(first)).toMatchObject({ position: 1 });
  });

  it("leaves a file that already has an owner alone", async () => {
    const mine = await ownerRow();
    const yours = await ownerRow();
    const taken = await upload({ ownerType: "project", ownerId: yours, position: 0 });
    const free = await upload();

    const claimed = await claimAttachments(db, [taken, free], {
      ownerType: "project",
      ownerId: mine,
    });

    // The whole point: a replayed submission carrying somebody else's
    // attachment id must not be able to steal their photo.
    expect(claimed).toBe(1);
    expect((await readAttachment(taken)).ownerId).toBe(yours);
    expect((await readAttachment(free)).ownerId).toBe(mine);
  });

  it("drops ids that are not uuid-shaped instead of handing them to Postgres", async () => {
    const projectId = await ownerRow();
    const real = await upload();

    // A Notion file_upload id, free text from a model — neither is a uuid, and
    // a uuid column answers a cast error rather than an empty result.
    const claimed = await claimAttachments(db, ["file-upload-1", "", real], {
      ownerType: "project",
      ownerId: projectId,
    });

    expect(claimed).toBe(1);
    expect((await readAttachment(real)).ownerId).toBe(projectId);
  });

  it("claims nothing, and asks Postgres nothing, for an empty list", async () => {
    const projectId = await ownerRow();

    expect(
      await claimAttachments(db, [], { ownerType: "project", ownerId: projectId })
    ).toBe(0);
    expect(
      await claimAttachments(db, ["not-a-uuid"], {
        ownerType: "maintenance_log",
        ownerId: projectId,
      })
    ).toBe(0);
  });

  it("counts a repeated id once", async () => {
    const projectId = await ownerRow();
    const photo = await upload();

    const claimed = await claimAttachments(db, [photo, photo], {
      ownerType: "project",
      ownerId: projectId,
    });

    expect(claimed).toBe(1);
    expect((await readAttachment(photo)).position).toBe(0);
  });

  it("reports zero when every id was already spoken for", async () => {
    const mine = await ownerRow();
    const yours = await ownerRow();
    const taken = await upload({ ownerType: "project", ownerId: yours });

    // Zero is what lets a caller say "the photos did not attach" rather than
    // silently filing a record without them.
    expect(
      await claimAttachments(db, [taken], { ownerType: "project", ownerId: mine })
    ).toBe(0);
  });
});

describe("createAttachment", () => {
  it("records an upload with NO owner — the ticket it belongs to does not exist yet", async () => {
    const { id } = await createAttachment(
      {
        blobPathname: "uploads/project/lamp-Xa9k2.png",
        access: "public",
        publicUrl: "https://store.public.blob.vercel-storage.com/lamp-Xa9k2.png",
        contentType: "image/png",
        sizeBytes: 1234,
        originalFilename: "lamp.png",
        uploadedBy: null,
      },
      { db }
    );

    expect(await readAttachment(id)).toMatchObject({
      ownerType: null,
      ownerId: null,
      blobPathname: "uploads/project/lamp-Xa9k2.png",
      access: "public",
      sizeBytes: 1234,
      originalFilename: "lamp.png",
      uploadedBy: null,
    });
  });

  it("stores a private upload with no public url, because a private blob has none", async () => {
    const { id } = await createAttachment(
      {
        blobPathname: "uploads/maintenance/bed-Q1.png",
        access: "private",
        publicUrl: null,
        contentType: "image/png",
        sizeBytes: 10,
        originalFilename: "bed.png",
        uploadedBy: "user_1",
      },
      { db }
    );

    const row = await readAttachment(id);
    expect(row.access).toBe("private");
    expect(row.publicUrl).toBeNull();
    // The signed-in uploader is recorded so staff can ask them about the photo.
    expect(row.uploadedBy).toBe("user_1");
  });
});

describe("findAttachmentsByIds", () => {
  it("returns the rows asked for and ignores ids that are not uuid-shaped", async () => {
    const first = await upload();
    const second = await upload();

    const found = await findAttachmentsByIds(
      [first, "file-upload-1", second],
      { db }
    );

    expect(found.map((row) => row.id).sort()).toEqual([first, second].sort());
  });

  it("asks Postgres nothing when no id could address a row", async () => {
    expect(await findAttachmentsByIds(["", "nope"], { db })).toEqual([]);
  });
});

describe("listOrphanedAttachments", () => {
  const HOUR = 60 * 60 * 1000;
  const NOW = new Date("2026-09-20T12:00:00.000Z");
  const CUTOFF = new Date(NOW.getTime() - 24 * HOUR);

  it("returns only unowned files older than the cutoff", async () => {
    const stale = await upload({
      createdAt: new Date(NOW.getTime() - 25 * HOUR),
    });
    await upload({ createdAt: new Date(NOW.getTime() - HOUR) });

    const orphans = await listOrphanedAttachments(CUTOFF, { db });

    expect(orphans.map((row) => row.id)).toEqual([stale]);
  });

  it("never returns a claimed file, however old it is", async () => {
    const projectId = await ownerRow();
    await upload({
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
      ownerType: "project",
      ownerId: projectId,
    });

    // A claimed photo is somebody's record. Age is not a reason to delete it.
    expect(await listOrphanedAttachments(CUTOFF, { db })).toEqual([]);
  });
});

describe("deleteAttachments", () => {
  it("removes the rows it is given and reports the count", async () => {
    const doomed = await upload();
    const kept = await upload();

    expect(await deleteAttachments([doomed, "not-a-uuid"], { db })).toBe(1);
    expect(await readAttachment(doomed)).toBeUndefined();
    expect(await readAttachment(kept)).toBeDefined();
  });

  it("deletes nothing for an empty list", async () => {
    const kept = await upload();
    expect(await deleteAttachments([], { db })).toBe(0);
    expect(await readAttachment(kept)).toBeDefined();
  });
});

describe("listAttachmentsForOwner", () => {
  it("returns one owner's files, cover first", async () => {
    const projectId = await ownerRow();
    const second = await upload();
    const cover = await upload();
    await claimAttachments(db, [cover, second], { ownerType: "project", ownerId: projectId });
    await upload();

    const rows = await listAttachmentsForOwner(db, { ownerType: "project", ownerId: projectId });

    expect(rows.map((row) => row.id)).toEqual([cover, second]);
  });

  it("is empty for an owner with nothing, and for a non-uuid id", async () => {
    expect(await listAttachmentsForOwner(db, { ownerType: "project", ownerId: "nope" })).toEqual([]);
  });
});

describe("reorderAttachments", () => {
  it("rewrites positions so the first id becomes the cover", async () => {
    const projectId = await ownerRow();
    const owner = { ownerType: "project" as const, ownerId: projectId };
    const first = await upload();
    const second = await upload();
    await claimAttachments(db, [first, second], owner);

    expect(await reorderAttachments(db, owner, [second, first])).toBe(2);

    const rows = await listAttachmentsForOwner(db, owner);
    expect(rows.map((row) => [row.id, row.position])).toEqual([
      [second, 0],
      [first, 1],
    ]);
  });

  it("cannot reach across owners", async () => {
    const mine = await ownerRow();
    const theirs = await ownerRow();
    const theirPhoto = await upload();
    await claimAttachments(db, [theirPhoto], { ownerType: "project", ownerId: theirs });

    const moved = await reorderAttachments(db, { ownerType: "project", ownerId: mine }, [theirPhoto]);

    expect(moved).toBe(0);
    expect((await readAttachment(theirPhoto)).ownerId).toBe(theirs);
  });
});

describe("releaseAttachments", () => {
  it("unowns the named files so the daily sweep can collect them", async () => {
    const projectId = await ownerRow();
    const owner = { ownerType: "project" as const, ownerId: projectId };
    const removed = await upload();
    const kept = await upload();
    await claimAttachments(db, [removed, kept], owner);

    expect(await releaseAttachments(db, owner, [removed])).toBe(1);

    // The row survives — it is the only handle anything has on the blob, and
    // the cron deletes the bytes first and the row second.
    expect(await readAttachment(removed)).toMatchObject({
      ownerType: null,
      ownerId: null,
      position: 0,
    });
    expect((await readAttachment(kept)).ownerId).toBe(projectId);
  });

  it("releases everything an owner holds when no ids are named", async () => {
    const projectId = await ownerRow();
    const owner = { ownerType: "project" as const, ownerId: projectId };
    await claimAttachments(db, [await upload(), await upload()], owner);

    expect(await releaseAttachments(db, owner)).toBe(2);
    expect(await listAttachmentsForOwner(db, owner)).toEqual([]);
  });

  it("cannot release another owner's file", async () => {
    const mine = await ownerRow();
    const theirs = await ownerRow();
    const theirPhoto = await upload();
    await claimAttachments(db, [theirPhoto], { ownerType: "project", ownerId: theirs });

    expect(
      await releaseAttachments(db, { ownerType: "project", ownerId: mine }, [theirPhoto])
    ).toBe(0);
    expect((await readAttachment(theirPhoto)).ownerId).toBe(theirs);
  });
});
