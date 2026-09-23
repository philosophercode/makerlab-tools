// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { rawRows } from "../db/raw";
import {
  attachments,
  categories,
  locations,
  pendingTools,
  resources,
  tools,
  units,
  user,
} from "../db/schema/index";
import type { Db } from "../db/types";
import type { ResearchResult } from "../research/result";
import {
  approvePendingAsUnit,
  approvePendingTool,
  createPendingBatch,
  discardPendingTool,
  expireIdentifiedPendingTools,
  getPendingTool,
  listPendingTools,
  type ApprovalFields,
} from "./pending-tools";

/**
 * Approval against a real (in-process) Postgres (spec §5.4 step 11, §10
 * "approval is transactional and re-owns attachments").
 *
 * This is the one place research becomes catalogue, and Article 5 says a
 * person decides it. So the assertions are about what cannot happen as much as
 * what does: nothing half-created when a step fails, no approval twice, no
 * low-confidence item through without the reviewer's note.
 */

let db: Db;
const OWNER = "approve-owner";
const APPROVER = "approve-approver";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values([
    { id: OWNER, name: "Owner", email: "approve-owner@cornell.edu" },
    { id: APPROVER, name: "Approver", email: "approve-approver@cornell.edu" },
  ]);
});

beforeEach(async () => {
  await db.delete(pendingTools);
  await db.delete(attachments);
  await db.delete(tools);
  await db.delete(categories);
  await db.delete(locations);
});

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Prusa MK4S",
    description: "An FDM printer.",
    specs: [{ label: "Build volume", value: "250 × 210 × 220 mm" }],
    materials: ["PLA", "PETG"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [
      { title: "Manual", url: "https://example.com/manual.pdf", type: "Manual" },
      { title: "Unboxing", url: "https://example.com/video", type: "Video" },
    ],
    droppedLinks: [],
    sourceUrls: ["https://example.com/mk4s"],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: true,
      specsFromSource: true,
      categoryOnly: false,
    },
    confidence: { level: "high", basis: [], unknowns: [] },
    ...overrides,
  };
}

function fields(overrides: Partial<ApprovalFields> = {}): ApprovalFields {
  return {
    name: "Prusa MK4S",
    description: "An FDM printer.",
    categoryId: null,
    locationId: null,
    materials: ["PLA", "PETG"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    serialNumber: "SN-100",
    ...overrides,
  };
}

async function photo(): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({ blobPathname: `uploads/chat/${crypto.randomUUID()}.png`, access: "private", uploadedBy: OWNER })
    .returning({ id: attachments.id });
  return row.id;
}

/** A researched item with photos, ready for the preliminary page. */
async function researchedItem(
  options: { research?: ResearchResult; photos?: string[]; name?: string } = {}
): Promise<string> {
  const batch = await createPendingBatch(
    {
      createdBy: OWNER,
      items: [{ name: options.name ?? "Prusa MK4S", attachmentIds: options.photos ?? [] }],
    },
    { db }
  );
  const id = batch.items[0].id;
  await db
    .update(pendingTools)
    .set({ status: "researched", research: options.research ?? research() })
    .where(eq(pendingTools.id, id));
  return id;
}

async function counts() {
  const [row] = await rawRows<Record<"tools" | "units" | "resources" | "categories", number>>(
    db,
    sql`
      select (select count(*) from tools)::int as tools,
             (select count(*) from units)::int as units,
             (select count(*) from resources)::int as resources,
             (select count(*) from categories)::int as categories
    `
  );
  return row;
}

describe("approvePendingTool", () => {
  it("creates the tool, its unit and resources, re-owns the photos in order, and marks the row approved", async () => {
    const photos = [await photo(), await photo(), await photo()];
    const id = await researchedItem({ photos: [photos[2], photos[0], photos[1]] });

    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: true, fields: fields() },
      { db }
    );

    expect(result).toMatchObject({
      ok: true,
      slug: "prusa-mk4s",
      resourcesCreated: 2,
      photosMoved: 3,
      published: true,
      overridden: false,
    });
    if (!result.ok) throw new Error("unreachable");

    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool).toMatchObject({
      name: "Prusa MK4S",
      published: true,
      trainingRequired: true,
      createdBy: APPROVER,
    });
    const [unit] = await db.select().from(units).where(eq(units.toolId, result.toolId));
    expect(unit).toMatchObject({ id: result.unitId, unitLabel: "Prusa MK4S #1", serialNumber: "SN-100" });

    const moved = await db
      .select({ id: attachments.id, ownerType: attachments.ownerType, position: attachments.position })
      .from(attachments)
      .where(eq(attachments.ownerId, result.toolId))
      .orderBy(attachments.position);
    expect(moved).toEqual([
      { id: photos[2], ownerType: "tool", position: 0 },
      { id: photos[0], ownerType: "tool", position: 1 },
      { id: photos[1], ownerType: "tool", position: 2 },
    ]);

    expect(await getPendingTool(id, { db })).toMatchObject({
      status: "approved",
      approvedBy: APPROVER,
      createdToolId: result.toolId,
      createdUnitId: result.unitId,
      approvalNote: null,
      photos: [],
    });
    expect((await getPendingTool(id, { db }))?.approvedAt).toBeInstanceOf(Date);
  });

  it("approves as a draft when told to", async () => {
    const id = await researchedItem();
    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: false, fields: fields() },
      { db }
    );
    expect(result).toMatchObject({ ok: true, published: false });
    if (!result.ok) throw new Error("unreachable");
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool.published).toBe(false);
  });

  it("refuses a second approval", async () => {
    const id = await researchedItem();
    const input = { id, actorUserId: APPROVER, publish: true, fields: fields() };
    expect((await approvePendingTool(input, { db })).ok).toBe(true);
    expect(await approvePendingTool(input, { db })).toEqual({ ok: false, reason: "not_editable" });
    expect((await counts()).tools).toBe(1);
  });

  it("refuses an item that is not researched, or is an add-unit item", async () => {
    const batch = await createPendingBatch({ createdBy: OWNER, items: [{ name: "Waiting" }] }, { db });
    const identified = batch.items[0].id;
    expect(
      await approvePendingTool({ id: identified, actorUserId: APPROVER, publish: true, fields: fields() }, { db })
    ).toEqual({ ok: false, reason: "not_editable" });

    const unitItem = await researchedItem();
    await db.update(pendingTools).set({ duplicateResolution: "add_unit" }).where(eq(pendingTools.id, unitItem));
    expect(
      await approvePendingTool({ id: unitItem, actorUserId: APPROVER, publish: true, fields: fields() }, { db })
    ).toEqual({ ok: false, reason: "not_editable" });

    expect(
      await approvePendingTool(
        { id: crypto.randomUUID(), actorUserId: APPROVER, publish: true, fields: fields() },
        { db }
      )
    ).toEqual({ ok: false, reason: "not_found" });
  });

  it("holds a low-confidence item until the reviewer adds a note, then stores it", async () => {
    const id = await researchedItem({
      research: research({ confidence: { level: "low", basis: [], unknowns: ["model"] } }),
    });
    const input = { id, actorUserId: APPROVER, publish: true, fields: fields() };

    expect(await approvePendingTool(input, { db })).toEqual({ ok: false, reason: "low_confidence" });
    expect(await approvePendingTool({ ...input, overrideNote: "   " }, { db })).toEqual({
      ok: false,
      reason: "low_confidence",
    });
    expect((await counts()).tools).toBe(0);

    const result = await approvePendingTool(
      { ...input, overrideNote: " Checked the plate on the machine. " },
      { db }
    );
    expect(result).toMatchObject({ ok: true, overridden: true });
    expect((await getPendingTool(id, { db }))?.approvalNote).toBe("Checked the plate on the machine.");
  });

  it("creates the proposed category when none was picked, and reuses one that matches", async () => {
    const first = await researchedItem({ name: "First" });
    const created = await approvePendingTool(
      {
        id: first,
        actorUserId: APPROVER,
        publish: true,
        fields: fields({ name: "First", newCategory: { name: "FDM", group: "3D Printing" } }),
      },
      { db }
    );
    if (!created.ok) throw new Error(created.reason);
    const [tool] = await db.select().from(tools).where(eq(tools.id, created.toolId));
    const [category] = await db.select().from(categories);
    expect(category).toMatchObject({ name: "FDM", group: "3D Printing" });
    expect(tool.categoryId).toBe(category.id);

    const second = await researchedItem({ name: "Second" });
    const reused = await approvePendingTool(
      {
        id: second,
        actorUserId: APPROVER,
        publish: true,
        fields: fields({ name: "Second", newCategory: { name: "fdm", group: "3d printing" } }),
      },
      { db }
    );
    if (!reused.ok) throw new Error(reused.reason);
    expect((await counts()).categories).toBe(1);
  });

  it("keeps only the resources the reviewer chose, and refuses one research never verified", async () => {
    const id = await researchedItem();
    expect(
      await approvePendingTool(
        {
          id,
          actorUserId: APPROVER,
          publish: true,
          fields: fields({ resourceUrls: ["https://evil.example/not-verified"] }),
        },
        { db }
      )
    ).toEqual({ ok: false, reason: "invalid_field" });

    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: true, fields: fields({ resourceUrls: ["https://example.com/video"] }) },
      { db }
    );
    expect(result).toMatchObject({ ok: true, resourcesCreated: 1 });
    if (!result.ok) throw new Error("unreachable");
    const rows = await db.select().from(resources).where(eq(resources.toolId, result.toolId));
    expect(rows.map((row) => [row.title, row.type, row.url])).toEqual([
      ["Unboxing", "Video", "https://example.com/video"],
    ]);
  });

  it("refuses a category or location that does not exist, and a blank name", async () => {
    const id = await researchedItem();
    const base = { id, actorUserId: APPROVER, publish: true };
    expect(await approvePendingTool({ ...base, fields: fields({ categoryId: crypto.randomUUID() }) }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(await approvePendingTool({ ...base, fields: fields({ locationId: "bench-2" }) }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect(await approvePendingTool({ ...base, fields: fields({ name: "  " }) }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
    expect((await getPendingTool(id, { db }))?.status).toBe("researched");
  });

  it("is transactional: a failure mid-way leaves no tool, no category, no unit and the photos where they were", async () => {
    const photos = [await photo(), await photo()];
    const id = await researchedItem({ photos });
    const before = await counts();

    // Fail the unit insert — after the category and the tool have been
    // written — the way a constraint or a dropped connection would.
    await db.execute(sql`
      create function refuse_units() returns trigger as $$
      begin raise exception 'units are unavailable'; end;
      $$ language plpgsql`);
    await db.execute(sql`create trigger refuse_units before insert on units for each row execute function refuse_units()`);
    try {
      await expect(
        approvePendingTool(
          {
            id,
            actorUserId: APPROVER,
            publish: true,
            fields: fields({ newCategory: { name: "FDM", group: "3D Printing" } }),
          },
          { db }
        )
      ).rejects.toThrow();
    } finally {
      await db.execute(sql`drop trigger refuse_units on units`);
      await db.execute(sql`drop function refuse_units()`);
    }

    expect(await counts()).toEqual(before);
    const item = await getPendingTool(id, { db });
    expect(item?.status).toBe("researched");
    expect(item?.photos.map((p) => p.attachmentId)).toEqual(photos);
  });
});

describe("approvePendingAsUnit", () => {
  async function toolWithUnit() {
    const [tool] = await db
      .insert(tools)
      .values({ slug: "form-4", name: "Form 4", published: true })
      .returning({ id: tools.id });
    await db.insert(units).values({ toolId: tool.id, unitLabel: "Form 4 #1", serialNumber: "SN-1" });
    const cover = await photo();
    await db.update(attachments).set({ ownerType: "tool", ownerId: tool.id, position: 0 }).where(eq(attachments.id, cover));
    return { toolId: tool.id, cover };
  }

  async function unitItem(serialNumber: string | null, photos: string[] = []) {
    const batch = await createPendingBatch(
      { createdBy: OWNER, items: [{ name: "Form 4", serialNumber, attachmentIds: photos }] },
      { db }
    );
    const id = batch.items[0].id;
    await db
      .update(pendingTools)
      .set({ status: "researched", duplicateResolution: "add_unit" })
      .where(eq(pendingTools.id, id));
    return id;
  }

  it("adds the next unit to the matched tool and appends the photos", async () => {
    const { toolId, cover } = await toolWithUnit();
    const itemPhoto = await photo();
    const id = await unitItem("SN-2", [itemPhoto]);
    expect((await getPendingTool(id, { db }))?.duplicateOfToolId).toBe(toolId);

    const result = await approvePendingAsUnit({ id, actorUserId: APPROVER }, { db });

    // The tool's state comes back from inside the transaction.
    expect(result).toMatchObject({ ok: true, toolId, slug: "form-4", photosMoved: 1, published: true });
    if (!result.ok) throw new Error("unreachable");
    const [unit] = await db.select().from(units).where(eq(units.id, result.unitId));
    expect(unit).toMatchObject({ unitLabel: "Form 4 #2", serialNumber: "SN-2", createdBy: APPROVER });
    const onTool = await db
      .select({ id: attachments.id, position: attachments.position })
      .from(attachments)
      .where(eq(attachments.ownerId, toolId))
      .orderBy(attachments.position);
    expect(onTool).toEqual([
      { id: cover, position: 0 },
      { id: itemPhoto, position: 1 },
    ]);
    expect(await getPendingTool(id, { db })).toMatchObject({
      status: "approved",
      createdToolId: toolId,
      createdUnitId: result.unitId,
    });
  });

  it("releases the item's cleaned copy instead of making it a photo of the existing tool", async () => {
    const { toolId, cover } = await toolWithUnit();
    const itemPhoto = await photo();
    const id = await unitItem("SN-2", [itemPhoto]);
    // Research made a private background-removed copy while the item still
    // looked new; then it matched an existing tool and became an add-unit item.
    const [cleaned] = await db
      .insert(attachments)
      .values({
        blobPathname: `research/${crypto.randomUUID()}.png`,
        access: "private",
        origin: "research_image_cleaned",
        sourceUrl: "https://example.com/form-4.png",
        ownerType: "pending_tool",
        ownerId: id,
      })
      .returning({ id: attachments.id });

    const result = await approvePendingAsUnit({ id, actorUserId: APPROVER }, { db });

    expect(result).toMatchObject({ ok: true, photosMoved: 1 });
    const onTool = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.ownerId, toolId))
      .orderBy(attachments.position);
    expect(onTool.map((row) => row.id)).toEqual([cover, itemPhoto]);
    const [released] = await db
      .select({ ownerType: attachments.ownerType, ownerId: attachments.ownerId })
      .from(attachments)
      .where(eq(attachments.id, cleaned.id));
    expect(released).toEqual({ ownerType: null, ownerId: null });
  });

  it("lets the reviewer's serial number win over the stored one", async () => {
    await toolWithUnit();
    const id = await unitItem("SN-OLD");
    const result = await approvePendingAsUnit({ id, actorUserId: APPROVER, serialNumber: " SN-NEW " }, { db });
    if (!result.ok) throw new Error(result.reason);
    const [unit] = await db.select().from(units).where(eq(units.id, result.unitId));
    expect(unit.serialNumber).toBe("SN-NEW");
  });

  it("refuses a serial the tool already has, and writes nothing", async () => {
    const { toolId } = await toolWithUnit();
    const itemPhoto = await photo();
    const id = await unitItem("sn-1", [itemPhoto]);

    expect(await approvePendingAsUnit({ id, actorUserId: APPROVER }, { db })).toEqual({
      ok: false,
      reason: "duplicate_serial",
    });
    expect(await db.select().from(units).where(eq(units.toolId, toolId))).toHaveLength(1);
    expect(await getPendingTool(id, { db })).toMatchObject({
      status: "researched",
      photos: [expect.objectContaining({ attachmentId: itemPhoto })],
    });
  });

  it("refuses an item that is not an add-unit item, or whose tool is gone", async () => {
    const plain = await researchedItem();
    expect(await approvePendingAsUnit({ id: plain, actorUserId: APPROVER }, { db })).toEqual({
      ok: false,
      reason: "not_editable",
    });

    const { toolId } = await toolWithUnit();
    const orphaned = await unitItem("SN-9");
    await db.delete(tools).where(eq(tools.id, toolId));
    expect(await approvePendingAsUnit({ id: orphaned, actorUserId: APPROVER }, { db })).toEqual({
      ok: false,
      reason: "invalid_field",
    });
  });

  it("refuses a second approval", async () => {
    await toolWithUnit();
    const id = await unitItem("SN-3");
    expect((await approvePendingAsUnit({ id, actorUserId: APPROVER }, { db })).ok).toBe(true);
    expect(await approvePendingAsUnit({ id, actorUserId: APPROVER }, { db })).toEqual({
      ok: false,
      reason: "not_editable",
    });
  });
});

describe("approvePendingTool — the product image (gateway spec §5.2)", () => {
  /** A research image stage file: the cleaned copy (owned by the item) or a chosen original (unowned). */
  async function researchImage(
    origin: "research_image" | "research_image_cleaned",
    owner: string | null = null
  ): Promise<string> {
    const [row] = await db
      .insert(attachments)
      .values({
        blobPathname: `research/${crypto.randomUUID()}.png`,
        access: origin === "research_image" ? "public" : "private",
        origin,
        sourceUrl: "https://example.com/mk4s.png",
        ownerType: owner ? "pending_tool" : null,
        ownerId: owner,
      })
      .returning({ id: attachments.id });
    return row.id;
  }

  async function ownerOf(id: string) {
    const [row] = await db
      .select({ ownerType: attachments.ownerType, ownerId: attachments.ownerId, position: attachments.position })
      .from(attachments)
      .where(eq(attachments.id, id));
    return row;
  }

  it("puts a chosen original at the cover position, before the photos the admin uploaded", async () => {
    const uploads = [await photo(), await photo()];
    const id = await researchedItem({ photos: uploads });
    const original = await researchImage("research_image");

    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: true, fields: fields(), coverAttachmentId: original },
      { db }
    );

    expect(result).toMatchObject({ ok: true, coverAttached: true, photosMoved: 2 });
    if (!result.ok) throw new Error("unreachable");
    const moved = await db
      .select({ id: attachments.id, position: attachments.position })
      .from(attachments)
      .where(eq(attachments.ownerId, result.toolId))
      .orderBy(attachments.position);
    expect(moved).toEqual([
      { id: original, position: 0 },
      { id: uploads[0], position: 1 },
      { id: uploads[1], position: 2 },
    ]);
  });

  it("keeps the chosen cleaned copy as the cover and releases every other one", async () => {
    const id = await researchedItem();
    const chosen = await researchImage("research_image_cleaned", id);
    const stale = await researchImage("research_image_cleaned", id);

    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: true, fields: fields(), coverAttachmentId: chosen },
      { db }
    );

    expect(result).toMatchObject({ ok: true, coverAttached: true, photosMoved: 0 });
    if (!result.ok) throw new Error("unreachable");
    expect(await ownerOf(chosen)).toEqual({ ownerType: "tool", ownerId: result.toolId, position: 0 });
    expect(await ownerOf(stale)).toEqual({ ownerType: null, ownerId: null, position: 0 });
  });

  it("releases an unchosen cleaned copy when no image is chosen, and never makes it a tool photo", async () => {
    const upload = await photo();
    const id = await researchedItem({ photos: [upload] });
    const cleaned = await researchImage("research_image_cleaned", id);

    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: true, fields: fields() },
      { db }
    );

    expect(result).toMatchObject({ ok: true, coverAttached: false, photosMoved: 1 });
    if (!result.ok) throw new Error("unreachable");
    expect(await ownerOf(cleaned)).toEqual({ ownerType: null, ownerId: null, position: 0 });
    expect(await ownerOf(upload)).toEqual({ ownerType: "tool", ownerId: result.toolId, position: 0 });
  });

  it("will not take a cover that is somebody else's file, and says it did not", async () => {
    const id = await researchedItem();
    const other = await researchedItem({ name: "Another printer" });
    const theirs = await researchImage("research_image_cleaned", other);
    const upload = await photo(); // unowned, but an upload — not a research image

    for (const coverAttachmentId of [theirs, upload, "not-a-uuid"]) {
      await db.update(pendingTools).set({ status: "researched" }).where(eq(pendingTools.id, id));
      const result = await approvePendingTool(
        { id, actorUserId: APPROVER, publish: false, fields: fields(), coverAttachmentId },
        { db }
      );
      expect(result).toMatchObject({ ok: true, coverAttached: false });
      await db.delete(tools);
    }
    expect(await ownerOf(theirs)).toMatchObject({ ownerType: "pending_tool", ownerId: other });
    expect(await ownerOf(upload)).toMatchObject({ ownerType: null, ownerId: null });
  });

  it("moves nothing when the approval is refused: the cleaned copy stays with the item", async () => {
    const id = await researchedItem({ research: research({ confidence: { level: "low", basis: [], unknowns: [] } }) });
    const cleaned = await researchImage("research_image_cleaned", id);
    const original = await researchImage("research_image");

    const result = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: true, fields: fields(), coverAttachmentId: original },
      { db }
    );

    expect(result).toEqual({ ok: false, reason: "low_confidence" });
    expect(await ownerOf(cleaned)).toMatchObject({ ownerType: "pending_tool", ownerId: id });
    // Left unowned for the 24-hour orphan sweep, like any upload nobody claimed.
    expect(await ownerOf(original)).toMatchObject({ ownerType: null, ownerId: null });
  });
});

describe("the cleaned copy is not a photo", () => {
  it("never appears among an item's photos, in either read", async () => {
    const upload = await photo();
    const id = await researchedItem({ photos: [upload] });
    const [cleaned] = await db
      .insert(attachments)
      .values({
        blobPathname: "research/cleaned.png",
        access: "private",
        origin: "research_image_cleaned",
        ownerType: "pending_tool",
        ownerId: id,
      })
      .returning({ id: attachments.id });

    expect((await getPendingTool(id, { db }))?.photos.map((p) => p.attachmentId)).toEqual([upload]);
    const [listed] = await listPendingTools({ ids: [id] }, { db });
    expect(listed.photos.map((p) => p.attachmentId)).toEqual([upload]);
    expect(listed.photos.map((p) => p.attachmentId)).not.toContain(cleaned.id);
  });

  it("is released with the item's photos when the item is discarded", async () => {
    const upload = await photo();
    const id = await researchedItem({ photos: [upload] });
    const [cleaned] = await db
      .insert(attachments)
      .values({
        blobPathname: "research/cleaned.png",
        access: "private",
        origin: "research_image_cleaned",
        ownerType: "pending_tool",
        ownerId: id,
      })
      .returning({ id: attachments.id });

    const discarded = await discardPendingTool(id, { db });

    expect(discarded).toMatchObject({ ok: true, released: 2 });
    const rows = await db
      .select({ id: attachments.id, ownerId: attachments.ownerId })
      .from(attachments)
      .where(eq(attachments.id, cleaned.id));
    expect(rows).toEqual([{ id: cleaned.id, ownerId: null }]);
  });

  it("is released when an identified item expires", async () => {
    const batch = await createPendingBatch({ createdBy: OWNER, items: [{ name: "Old laser" }] }, { db });
    const id = batch.items[0].id;
    await db.insert(attachments).values({
      blobPathname: "research/cleaned-old.png",
      access: "private",
      origin: "research_image_cleaned",
      ownerType: "pending_tool",
      ownerId: id,
    });

    const expired = await expireIdentifiedPendingTools(new Date(Date.now() + 60_000), { db });

    expect(expired).toEqual({ discarded: [id], releasedAttachments: 1 });
  });
});
