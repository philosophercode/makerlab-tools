// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { attachments, categories, locations, maintenanceLogs, resources, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import { listToolsForExport } from "./tool-export";

/**
 * The tools CSV's read, against a real (in-process) Postgres: every state,
 * the selection, and public links only.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(maintenanceLogs);
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(categories);
  await db.delete(locations);
});

async function addTool(slug: string, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug, name, published: true, ...extra })
    .returning({ id: tools.id });
  return row.id;
}

describe("listToolsForExport", () => {
  it("returns every tool with its status: published, draft and archived", async () => {
    await addTool("form-4", "Form 4");
    await addTool("draft", "Draft Printer", { published: false });
    await addTool("old", "Old Router", { archivedAt: new Date("2026-01-01T00:00:00Z") });

    const records = await listToolsForExport({ db });

    expect(records.map((r) => [r.name, r.status])).toEqual([
      ["Draft Printer", "draft"],
      ["Form 4", "published"],
      ["Old Router", "archived"],
    ]);
  });

  it("returns only the selected ids, dropping ids that are not uuids", async () => {
    const form = await addTool("form-4", "Form 4");
    await addTool("speedy", "Speedy 400");
    const draft = await addTool("draft", "Draft Printer", { published: false });

    const records = await listToolsForExport({ db, ids: [form, draft, "not-a-uuid", form] });

    expect(records.map((r) => r.slug)).toEqual(["draft", "form-4"]);
  });

  it("returns nothing — not everything — for a selection with no usable id", async () => {
    await addTool("form-4", "Form 4");
    expect(await listToolsForExport({ db, ids: [] })).toEqual([]);
    expect(await listToolsForExport({ db, ids: ["'; drop table tools; --"] })).toEqual([]);
  });

  it("reads the category tree, location, units and the stored fields", async () => {
    const [parent] = await db.insert(categories).values({ name: "3D Printing", slug: "3d-printing" }).returning({ id: categories.id });
    const [child] = await db
      .insert(categories)
      .values({ name: "Resin Printers", slug: "resin-printers", parentId: parent.id })
      .returning({ id: categories.id });
    const [location] = await db
      .insert(locations)
      .values({ room: "MakerLAB", zone: "Resin Room", mapTag: "ML-RESIN-01" })
      .returning({ id: locations.id });
    const form = await addTool("form-4", "Form 4", {
      officialName: "Formlabs Form 4",
      categoryId: child.id,
      locationId: location.id,
      description: "Resin, clear.",
      ppeRequired: ["Gloves"],
      trainingRequired: true,
      tags: ["sla"],
    });
    const wash = await addTool("form-wash", "Form Wash", { itemKind: "accessory", parentToolId: form, categoryId: parent.id });
    await db.insert(units).values([
      { toolId: form, unitLabel: "Form 4 #2" },
      { toolId: form, unitLabel: "Form 4 #1", status: "retired" },
    ]);

    const [record] = await listToolsForExport({ db, ids: [form] });
    expect(record).toMatchObject({
      officialName: "Formlabs Form 4",
      category: "3D Printing",
      subcategory: "Resin Printers",
      room: "MakerLAB",
      zone: "Resin Room",
      mapTag: "ML-RESIN-01",
      description: "Resin, clear.",
      ppe: ["Gloves"],
      trainingRequired: true,
      tags: ["sla"],
      unitLabels: ["Form 4 #1", "Form 4 #2"],
    });
    expect(record.createdAt).toBeInstanceOf(Date);

    // A top-level category is the Category with no Subcategory; an accessory names its tool.
    const [accessory] = await listToolsForExport({ db, ids: [wash] });
    expect(accessory).toMatchObject({ category: "3D Printing", subcategory: null, itemKind: "accessory", accessoryOf: "form-4" });
  });

  it("lists public photos only, cover first — never a private file", async () => {
    const form = await addTool("form-4", "Form 4");
    await db.insert(attachments).values([
      { ownerType: "tool", ownerId: form, position: 1, blobPathname: "b.jpg", access: "public", publicUrl: "https://blob.test/second.jpg" },
      { ownerType: "tool", ownerId: form, position: 0, blobPathname: "a.jpg", access: "public", publicUrl: "https://blob.test/cover.jpg" },
      { ownerType: "tool", ownerId: form, position: 2, blobPathname: "p.jpg", access: "private", publicUrl: "https://private.blob.test/p.jpg" },
    ]);

    const [record] = await listToolsForExport({ db });
    expect(record.photoUrls).toEqual(["https://blob.test/cover.jpg", "https://blob.test/second.jpg"]);
  });

  it("lists published resources' public links only", async () => {
    const form = await addTool("form-4", "Form 4");
    const [manual] = await db
      .insert(resources)
      .values({ toolId: form, title: "Manual", type: "Manual", url: "https://formlabs.test/manual.pdf" })
      .returning({ id: resources.id });
    await db.insert(resources).values({ toolId: form, title: "Internal SOP", url: "https://intranet.test/sop", published: false });
    const [fileOnly] = await db.insert(resources).values({ toolId: form, title: "Quick start" }).returning({ id: resources.id });
    await db.insert(attachments).values([
      { ownerType: "resource", ownerId: fileOnly.id, blobPathname: "q.pdf", access: "public", publicUrl: "https://blob.test/quick.pdf" },
      { ownerType: "resource", ownerId: manual.id, blobPathname: "x.pdf", access: "private", publicUrl: "https://private.blob.test/x.pdf" },
    ]);

    const [record] = await listToolsForExport({ db });
    expect(record.resourceUrls).toEqual(["https://formlabs.test/manual.pdf", "https://blob.test/quick.pdf"]);
  });
});
