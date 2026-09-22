// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { revalidateTag } from "next/cache";

import { readToolRevision } from "../data/tools";
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { addResource, editResource, removeResource } from "./resource-edits";

/** The Resources section of the editor — a link, a PDF, or both. */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.mocked(revalidateTag).mockClear();
  await db.delete(attachments);
  await db.delete(tools);
  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4" })
    .returning({ id: tools.id });
  toolId = row.id;
});

async function context() {
  return { toolId, expectedRevision: (await readToolRevision(toolId, { db }))!, db };
}

/** An uploaded-but-unattached PDF, as `POST /api/uploads` leaves one. */
async function upload(): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/resource/${crypto.randomUUID()}.pdf`,
      access: "public",
      contentType: "application/pdf",
    })
    .returning({ id: attachments.id });
  return row.id;
}

describe("addResource", () => {
  it("adds a link and drops the catalogue cache", async () => {
    const result = await addResource(await context(), {
      title: "Form 4 manual",
      type: "Manual",
      url: "https://example.com/form-4.pdf",
    });

    expect(result).toMatchObject({ ok: true, filesSubmitted: 0, filesAttached: 0 });
    expect((await db.select().from(resources))[0]).toMatchObject({
      toolId,
      title: "Form 4 manual",
    });
    expect(revalidateTag).toHaveBeenCalledWith("catalog", "minutes");
  });

  it("claims an uploaded PDF onto the resource", async () => {
    const file = await upload();

    const result = await addResource(await context(), { title: "Form 4 manual" }, [file]);

    expect(result).toMatchObject({ ok: true, filesSubmitted: 1, filesAttached: 1 });
    expect((await db.select().from(attachments))[0]).toMatchObject({
      ownerType: "resource",
      ownerId: result.ok ? result.resourceId : "",
    });
  });

  it("keeps the resource but says when the file did not stick", async () => {
    // A panel left open overnight submits ids the daily cron has swept.
    const result = await addResource(await context(), { title: "Form 4 manual" }, [
      crypto.randomUUID(),
    ]);

    expect(result).toMatchObject({ ok: true, filesSubmitted: 1, filesAttached: 0 });
    expect(await db.select().from(resources)).toHaveLength(1);
  });

  it("refuses a link that is not one, and writes nothing", async () => {
    const before = (await context()).expectedRevision;

    const result = await addResource({ toolId, expectedRevision: before, db }, {
      title: "Manual",
      url: "example.com",
    });

    expect(result).toEqual({ ok: false, error: "invalid_field" });
    expect(await db.select().from(resources)).toHaveLength(0);
    expect(await readToolRevision(toolId, { db })).toBe(before);
  });
});

describe("editResource", () => {
  it("edits one of the tool's resources", async () => {
    const added = await addResource(await context(), { title: "Manual" });
    const resourceId = (added as { resourceId: string }).resourceId;

    const result = await editResource(await context(), resourceId, { published: false });

    expect(result.ok).toBe(true);
    expect((await db.select().from(resources))[0].published).toBe(false);
  });
});

describe("removeResource", () => {
  it("deletes the resource and releases its file to the orphan sweep", async () => {
    const file = await upload();
    const added = await addResource(await context(), { title: "Manual" }, [file]);

    const result = await removeResource(
      await context(),
      (added as { resourceId: string }).resourceId
    );

    expect(result.ok).toBe(true);
    expect(await db.select().from(resources)).toHaveLength(0);
    // The row outlives the resource on purpose: it is the only handle anything
    // has on the blob, and the cron deletes the bytes first.
    expect((await db.select().from(attachments))[0]).toMatchObject({
      ownerType: null,
      ownerId: null,
    });
  });
});
