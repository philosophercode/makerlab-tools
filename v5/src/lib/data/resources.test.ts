// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  createResource,
  deleteResource,
  listResources,
  listResourcesForTool,
  updateResource,
} from "./resources";

/**
 * Resource reads against a real (in-process) Postgres — what the chat route
 * needs to decide which of a tool's files are manuals worth attaching.
 */

let db: Db;
let form4: string;
let trotec: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  // Deleting the tools cascades to their resources.
  await db.delete(tools);

  const [a, b] = await db
    .insert(tools)
    .values([
      { slug: "form-4", name: "Form 4", published: true },
      { slug: "trotec-speedy-400", name: "Trotec Speedy 400", published: true },
    ])
    .returning({ id: tools.id });
  form4 = a.id;
  trotec = b.id;
});

type ResourceValues = typeof resources.$inferInsert;
type AttachmentValues = typeof attachments.$inferInsert;

async function insertResource(values: Partial<ResourceValues> = {}): Promise<string> {
  const [row] = await db
    .insert(resources)
    .values({ toolId: form4, title: "Form 4 manual", ...values })
    .returning({ id: resources.id });
  return row.id;
}

async function attachFile(resourceId: string, values: Partial<AttachmentValues> = {}) {
  await db.insert(attachments).values({
    ownerType: "resource",
    ownerId: resourceId,
    blobPathname: "resources/manual.pdf",
    access: "public",
    publicUrl: "https://blob.test/manual.pdf",
    ...values,
  });
}

// ── listResourcesForTool ────────────────────────────────────────────

describe("listResourcesForTool", () => {
  it("returns the tool's resources with their link and notes", async () => {
    await insertResource({
      title: "Form 4 SOP",
      type: "SOP",
      url: "https://x.test/sop.pdf",
      notes: "Read before the first print.",
    });

    expect(await listResourcesForTool(form4, { db })).toEqual([
      {
        id: expect.any(String),
        toolId: form4,
        title: "Form 4 SOP",
        type: "SOP",
        url: "https://x.test/sop.pdf",
        notes: "Read before the first print.",
        fileUrls: [],
      },
    ]);
  });

  it("carries a resource's public files, cover first", async () => {
    const id = await insertResource({ title: "Manual", url: null });
    await attachFile(id, { position: 1, publicUrl: "https://blob.test/second.pdf" });
    await attachFile(id, { position: 0, publicUrl: "https://blob.test/first.pdf" });

    const [resource] = await listResourcesForTool(form4, { db });
    expect(resource.fileUrls).toEqual([
      "https://blob.test/first.pdf",
      "https://blob.test/second.pdf",
    ]);
  });

  it("leaves out private files, which no visitor could open either", async () => {
    const id = await insertResource({ title: "Incident photos", url: null });
    await attachFile(id, { access: "private", publicUrl: null });

    const [resource] = await listResourcesForTool(form4, { db });
    expect(resource.fileUrls).toEqual([]);
  });

  it("leaves out unpublished resources — the assistant must not read what staff hid", async () => {
    await insertResource({ title: "Draft SOP", published: false });
    await insertResource({ title: "Live SOP", published: true });

    const titles = (await listResourcesForTool(form4, { db })).map((r) => r.title);
    expect(titles).toEqual(["Live SOP"]);
  });

  it("returns only the named tool's resources, ordered by title", async () => {
    await insertResource({ title: "Zebra chart" });
    await insertResource({ title: "Alpha guide" });
    await insertResource({ title: "Trotec SOP", toolId: trotec });

    const titles = (await listResourcesForTool(form4, { db })).map((r) => r.title);
    expect(titles).toEqual(["Alpha guide", "Zebra chart"]);
  });

  it("is empty for a tool with no resources, and for anything that is not a uuid", async () => {
    expect(await listResourcesForTool(trotec, { db })).toEqual([]);
    expect(await listResourcesForTool("form-4", { db })).toEqual([]);
  });
});

// ── listResources ───────────────────────────────────────────────────

describe("listResources", () => {
  it("returns every published resource in the lab, by title", async () => {
    await insertResource({ title: "Trotec SOP", toolId: trotec });
    await insertResource({ title: "Form 4 SOP" });
    await insertResource({ title: "Hidden", published: false });

    const rows = await listResources({ db });
    expect(rows.map((r) => r.title)).toEqual(["Form 4 SOP", "Trotec SOP"]);
    expect(rows.map((r) => r.toolId)).toEqual([form4, trotec]);
  });

  it("is empty when the lab has no resources", async () => {
    expect(await listResources({ db })).toEqual([]);
  });
});

// ── Writes ──────────────────────────────────────────────────────────

describe("createResource", () => {
  it("adds a manual to a tool and claims its uploaded file", async () => {
    const [upload] = await db
      .insert(attachments)
      .values({ blobPathname: "uploads/manual.pdf", access: "public", contentType: "application/pdf" })
      .returning({ id: attachments.id });

    const created = await createResource(
      db,
      form4,
      { title: "  Form 4 manual  ", type: "Manual", url: "https://example.com/form-4.pdf" },
      { fileAttachmentIds: [upload.id] }
    );

    expect(created).toEqual({ ok: true, resourceId: expect.any(String), filesAttached: 1 });
    const [row] = await db.select().from(resources);
    expect(row).toMatchObject({
      toolId: form4,
      title: "Form 4 manual",
      type: "Manual",
      url: "https://example.com/form-4.pdf",
      published: true,
    });
    const [file] = await db.select().from(attachments);
    expect(file).toMatchObject({ ownerType: "resource", ownerId: row.id, position: 0 });
  });

  it("reports a file it could not claim rather than implying it attached", async () => {
    // What a panel left open overnight sends: an id the daily cron has swept.
    const created = await createResource(db, form4, { title: "Manual" }, {
      fileAttachmentIds: [crypto.randomUUID()],
    });

    expect(created).toEqual({ ok: true, resourceId: expect.any(String), filesAttached: 0 });
  });

  it("refuses a link that is not one, and an empty title", async () => {
    // A bare `example.com` renders as a relative link and sends the reader to a
    // page on this site that does not exist.
    expect(await createResource(db, form4, { title: "Manual", url: "example.com" })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(await createResource(db, form4, { title: "   " })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(await db.select().from(resources)).toHaveLength(0);
  });
});

describe("updateResource", () => {
  it("edits one of the tool's resources and leaves the rest of it alone", async () => {
    const resourceId = await insertResource({ title: "Manual", notes: "kept" });

    const written = await updateResource(
      db,
      { toolId: form4, resourceId },
      { title: "Manual (2026)", published: false }
    );

    expect(written).toEqual({ ok: true, resourceId });
    const [row] = await db.select().from(resources);
    expect(row).toMatchObject({ title: "Manual (2026)", published: false, notes: "kept" });
  });

  it("does not reach a resource belonging to another tool", async () => {
    const resourceId = await insertResource({ title: "Manual" });

    expect(await updateResource(db, { toolId: trotec, resourceId }, { title: "Stolen" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("deleteResource", () => {
  it("removes the resource and releases its files to the orphan sweep", async () => {
    const resourceId = await insertResource({ title: "Manual" });
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: resourceId,
      blobPathname: "uploads/manual.pdf",
      access: "public",
      contentType: "application/pdf",
    });

    expect(await deleteResource(db, { toolId: form4, resourceId })).toEqual({
      ok: true,
      resourceId,
    });

    expect(await db.select().from(resources)).toHaveLength(0);
    // Unowned, not deleted: an attachment still pointing at a row that no longer
    // exists is invisible to every read *and* to the sweep.
    const [file] = await db.select().from(attachments);
    expect(file).toMatchObject({ ownerType: null, ownerId: null });
  });

  it("does not delete a resource belonging to another tool", async () => {
    const resourceId = await insertResource({ title: "Manual" });
    expect(await deleteResource(db, { toolId: trotec, resourceId })).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await db.select().from(resources)).toHaveLength(1);
  });
});
