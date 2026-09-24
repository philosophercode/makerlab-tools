// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import {
  attachments,
  categories,
  locations,
  maintenanceLogs,
  resources,
  tools,
  units,
} from "../db/schema/index";
import type { Db } from "../db/types";
import { listInventoryRows, listUnlinkedUnits, worseOf } from "./inventory";

/**
 * The review table's read, against a real (in-process) Postgres.
 *
 * The flags are the page, so most of this asserts that each one is true for
 * exactly the row that earns it — a green "no photo" on a tool that has one
 * would send somebody to look for work that is already done.
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

async function addTool(
  slug: string,
  name: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug, name, published: true, ...extra })
    .returning({ id: tools.id });
  return row.id;
}

async function addPhoto(toolId: string, extra: Record<string, unknown> = {}): Promise<void> {
  await db.insert(attachments).values({
    ownerType: "tool",
    ownerId: toolId,
    position: 0,
    blobPathname: `tools/${toolId}.jpg`,
    access: "public",
    publicUrl: `https://blob.test/${toolId}.jpg`,
    ...extra,
  });
}

async function rowFor(name: string) {
  const rows = await listInventoryRows({ db });
  const row = rows.find((candidate) => candidate.name === name);
  if (!row) throw new Error(`no inventory row named ${name}`);
  return row;
}

describe("listInventoryRows — what the table shows", () => {
  it("returns drafts and archived tools too: this list is not the catalogue", async () => {
    await addTool("form-4", "Form 4");
    await addTool("draft", "Draft Printer", { published: false });
    await addTool("old", "Retired Router", { archivedAt: new Date("2026-01-01T00:00:00Z") });

    const rows = await listInventoryRows({ db });

    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ["Draft Printer", "draft"],
      ["Form 4", "published"],
      ["Retired Router", "archived"],
    ]);
  });

  it("archived beats published — a tool can be both columns at once", async () => {
    await addTool("old", "Retired Router", {
      published: true,
      archivedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect((await rowFor("Retired Router")).state).toBe("archived");
  });

  it("carries the category, the location and the update stamp", async () => {
    const [category] = await db
      .insert(categories)
      .values({ name: "Resin Printing", group: "3D Printing" })
      .returning({ id: categories.id });
    const [location] = await db
      .insert(locations)
      .values({ room: "Bloomberg 061", zone: "Resin Bay" })
      .returning({ id: locations.id });
    await addTool("form-4", "Form 4", { categoryId: category.id, locationId: location.id });

    const row = await rowFor("Form 4");

    expect(row).toMatchObject({
      categoryName: "Resin Printing",
      categoryGroup: "3D Printing",
      room: "Bloomberg 061",
      zone: "Resin Bay",
    });
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it("counts units and reports the one furthest from ready", async () => {
    const toolId = await addTool("form-4", "Form 4");
    await db.insert(units).values([
      { toolId, unitLabel: "Form 4 #1", status: "available" },
      { toolId, unitLabel: "Form 4 #2", status: "out_of_service" },
      { toolId, unitLabel: "Form 4 #3", status: "in_use" },
    ]);

    expect(await rowFor("Form 4")).toMatchObject({
      unitCount: 3,
      worstUnitStatus: "out_of_service",
    });
  });

  it("reads a working tool as working even when one of its units is retired", async () => {
    const toolId = await addTool("form-4", "Form 4");
    await db.insert(units).values([
      { toolId, unitLabel: "Form 4 #1", status: "retired" },
      { toolId, unitLabel: "Form 4 #2", status: "available" },
    ]);

    expect((await rowFor("Form 4")).worstUnitStatus).toBe("available");
  });

  it("says nothing about units a tool does not have", async () => {
    await addTool("form-4", "Form 4");
    expect(await rowFor("Form 4")).toMatchObject({ unitCount: 0, worstUnitStatus: null });
  });
});

describe("listInventoryRows — needs attention", () => {
  it("flags a tool with no public photo, and clears it once one exists", async () => {
    const withPhoto = await addTool("form-4", "Form 4");
    await addTool("trotec", "Trotec Speedy 400");
    await addPhoto(withPhoto);

    expect((await rowFor("Form 4")).attention.noPhoto).toBe(false);
    expect((await rowFor("Trotec Speedy 400")).attention.noPhoto).toBe(true);
  });

  it("does not count a private file as a photo — the gallery could not show it", async () => {
    const toolId = await addTool("form-4", "Form 4");
    await addPhoto(toolId, { access: "private", publicUrl: null });

    const row = await rowFor("Form 4");
    expect(row.photoUrl).toBeNull();
    expect(row.attention.noPhoto).toBe(true);
  });

  it("takes the lowest-position photo as the cover", async () => {
    const toolId = await addTool("form-4", "Form 4");
    await addPhoto(toolId, { position: 3, publicUrl: "https://blob.test/third.jpg" });
    await addPhoto(toolId, { position: 0, publicUrl: "https://blob.test/cover.jpg" });

    expect((await rowFor("Form 4")).photoUrl).toBe("https://blob.test/cover.jpg");
  });

  it("counts an SOP, a PDF link and an attached PDF as a manual, and a video as none", async () => {
    const sop = await addTool("a", "A Tool");
    const pdfLink = await addTool("b", "B Tool");
    const pdfFile = await addTool("c", "C Tool");
    const video = await addTool("d", "D Tool");

    await db.insert(resources).values([
      { toolId: sop, title: "Form 4 SOP", type: "SOP", url: "#" },
      { toolId: pdfLink, title: "Manufacturer guide", type: null, url: "https://x.test/m.PDF" },
      { toolId: pdfFile, title: "Scanned manual", type: "Other" },
      { toolId: video, title: "Walkthrough", type: "Video", url: "https://x.test/v" },
    ]);
    const [scanned] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.toolId, pdfFile));
    await db.insert(attachments).values({
      ownerType: "resource",
      ownerId: scanned.id,
      blobPathname: "resources/manual.pdf",
      access: "public",
      publicUrl: "https://blob.test/manual.pdf",
      contentType: "application/pdf",
    });

    expect((await rowFor("A Tool")).attention.noManual).toBe(false);
    expect((await rowFor("B Tool")).attention.noManual).toBe(false);
    expect((await rowFor("C Tool")).attention.noManual).toBe(false);
    expect((await rowFor("D Tool")).attention.noManual).toBe(true);
  });

  it("flags open and in-progress tickets, and forgets resolved ones", async () => {
    const open = await addTool("a", "A Tool");
    const working = await addTool("b", "B Tool");
    const done = await addTool("c", "C Tool");

    await db.insert(maintenanceLogs).values([
      { toolId: open, title: "Resin leak", status: "open" },
      { toolId: working, title: "Bed levelling", status: "in_progress" },
      { toolId: done, title: "Old jam", status: "resolved" },
    ]);

    expect(await rowFor("A Tool")).toMatchObject({
      openTicketCount: 1,
      attention: expect.objectContaining({ openTickets: true }),
    });
    expect((await rowFor("B Tool")).attention.openTickets).toBe(true);
    expect(await rowFor("C Tool")).toMatchObject({
      openTicketCount: 0,
      attention: expect.objectContaining({ openTickets: false }),
    });
  });

  it("flags a tool nobody has ever reviewed", async () => {
    await addTool("a", "A Tool");
    await addTool("b", "B Tool", { lastReviewedAt: new Date("2026-06-01T00:00:00Z") });

    expect((await rowFor("A Tool")).attention.neverReviewed).toBe(true);
    expect((await rowFor("B Tool")).attention.neverReviewed).toBe(false);
  });

  it("leaves an archived tool out of the queue — archiving is an outcome of review", async () => {
    await addTool("old", "Retired Router", {
      published: false,
      archivedAt: new Date("2026-01-01T00:00:00Z"),
    });

    const row = await rowFor("Retired Router");
    expect(row.attention).toEqual({
      noPhoto: false,
      noManual: false,
      openTickets: false,
      neverReviewed: false,
    });
    expect(row.needsAttention).toBe(false);
  });

  it("sets needsAttention when any single flag is set", async () => {
    const toolId = await addTool("form-4", "Form 4", {
      lastReviewedAt: new Date("2026-06-01T00:00:00Z"),
    });
    await addPhoto(toolId);
    await db.insert(resources).values({ toolId, title: "SOP", type: "SOP", url: "#" });

    expect((await rowFor("Form 4")).needsAttention).toBe(false);

    await db.insert(maintenanceLogs).values({ toolId, title: "Resin leak", status: "open" });
    expect((await rowFor("Form 4")).needsAttention).toBe(true);
  });
});

describe("listInventoryRows — cost", () => {
  it("costs the same number of statements whether there are 2 tools or 20", async () => {
    async function statementsFor(toolCount: number): Promise<number> {
      await db.delete(tools);
      for (let index = 0; index < toolCount; index += 1) {
        const toolId = await addTool(`tool-${index}`, `Tool ${index}`);
        await addPhoto(toolId);
        await db.insert(units).values({ toolId, unitLabel: `Unit ${index}` });
        await db.insert(resources).values({ toolId, title: "SOP", type: "SOP", url: "#" });
        await db.insert(maintenanceLogs).values({ toolId, title: "Jam", status: "open" });
      }
      return countSelects(db, (counting) => listInventoryRows({ db: counting }));
    }

    expect(await statementsFor(2)).toBe(5);
    expect(await statementsFor(20)).toBe(5);
  });
});

describe("listUnlinkedUnits", () => {
  it("returns units that belong to no tool, and only those", async () => {
    const toolId = await addTool("form-4", "Form 4");
    await db.insert(units).values([
      { toolId, unitLabel: "Form 4 #1" },
      { unitLabel: "Mystery vinyl cutter", serialNumber: "SN-9", status: "out_of_service" },
    ]);

    expect(await listUnlinkedUnits({ db })).toEqual([
      expect.objectContaining({
        unitLabel: "Mystery vinyl cutter",
        serialNumber: "SN-9",
        status: "out_of_service",
      }),
    ]);
  });

  it("is empty when every unit has a tool", async () => {
    const toolId = await addTool("form-4", "Form 4");
    await db.insert(units).values({ toolId, unitLabel: "Form 4 #1" });
    expect(await listUnlinkedUnits({ db })).toEqual([]);
  });
});

describe("worseOf", () => {
  it("ranks out of service above maintenance above in use above available", () => {
    expect(worseOf("available", "in_use")).toBe("in_use");
    expect(worseOf("in_use", "under_maintenance")).toBe("under_maintenance");
    expect(worseOf("under_maintenance", "out_of_service")).toBe("out_of_service");
    expect(worseOf("out_of_service", "available")).toBe("out_of_service");
  });

  it("keeps retired only while there is nothing else to say", () => {
    expect(worseOf(null, "retired")).toBe("retired");
    expect(worseOf("retired", "available")).toBe("available");
  });

  it("never lets a value outside the vocabulary win", () => {
    expect(worseOf("available", "on_fire")).toBe("available");
    expect(worseOf(null, "on_fire")).toBeNull();
  });
});

/**
 * Runs `work` against a handle that counts how many statements it starts.
 *
 * Every read here begins with `db.select` or `db.selectDistinctOn`, so counting
 * those accesses counts statements — which is the property worth pinning: this
 * page must not become one query per tool as the inventory grows.
 */
async function countSelects(handle: Db, work: (db: Db) => Promise<unknown>): Promise<number> {
  let statements = 0;
  const counting = new Proxy(handle, {
    get(target, property, receiver) {
      if (property === "select" || property === "selectDistinctOn") statements += 1;
      return Reflect.get(target, property, receiver);
    },
  }) as Db;

  await work(counting);
  return statements;
}
