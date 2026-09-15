// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { listResources, listResourcesForTool } from "./resources";

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
