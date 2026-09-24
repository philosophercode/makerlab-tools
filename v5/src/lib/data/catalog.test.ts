// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import {
  attachments,
  categories,
  locations,
  resources,
  tools,
  units,
  UNIT_CONDITION,
  UNIT_STATUS,
} from "../db/schema/index";
import type { Db } from "../db/types";
import { manualSourceKey } from "./manual-archives";
import {
  countPublishedTools,
  deriveTrainingLabel,
  deriveTrainingLevel,
  findToolByIdOrSlug,
  findToolByNotionPageId,
  findToolBySlug,
  indexAttachments,
  listCatalogTools,
  localToolImage,
  resourceLinks,
  toCondition,
  toMakerLabUnit,
  toToolStatus,
  toolImageSrc,
  type AttachmentRow,
  type ResourceRow,
  type ToolRow,
  type UnitRow,
} from "./catalog";

/**
 * The catalogue read path, against a real (in-process) Postgres with rows this
 * file inserts — and the row→view mapping on its own, where the derivation
 * rules are easiest to exercise exhaustively.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  // Every test builds the catalogue it needs. Deleting tools cascades to their
  // units and resources; attachments are polymorphic and have no foreign key.
  await db.delete(attachments);
  await db.delete(tools);
  await db.delete(categories);
  await db.delete(locations);
});

// ── Fixtures ────────────────────────────────────────────────────────

type ToolValues = typeof tools.$inferInsert;
type UnitValues = typeof units.$inferInsert;
type ResourceValues = typeof resources.$inferInsert;

async function insertCategory(name: string, group: string | null): Promise<string> {
  const [row] = await db.insert(categories).values({ name, group }).returning({ id: categories.id });
  return row.id;
}

async function insertLocation(
  room: string,
  zone: string,
  mapTag: string | null
): Promise<string> {
  const [row] = await db
    .insert(locations)
    .values({ room, zone, mapTag })
    .returning({ id: locations.id });
  return row.id;
}

async function insertTool(values: ToolValues): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ published: true, ...values })
    .returning({ id: tools.id });
  return row.id;
}

async function insertUnit(values: UnitValues): Promise<string> {
  const [row] = await db.insert(units).values(values).returning({ id: units.id });
  return row.id;
}

async function insertResource(values: ResourceValues): Promise<string> {
  const [row] = await db.insert(resources).values(values).returning({ id: resources.id });
  return row.id;
}

async function insertAttachment(values: {
  ownerType: string;
  ownerId: string;
  position?: number;
  access?: string;
  publicUrl?: string | null;
  originalFilename?: string | null;
}): Promise<void> {
  await db.insert(attachments).values({
    ownerType: values.ownerType,
    ownerId: values.ownerId,
    position: values.position ?? 0,
    blobPathname: `blob/${values.ownerId}/${values.position ?? 0}`,
    access: values.access ?? "public",
    publicUrl: values.publicUrl === undefined ? "https://blob.example.com/photo.png" : values.publicUrl,
    originalFilename: values.originalFilename ?? null,
  });
}

/** A published tool with a category, a location, one unit and one resource. */
async function seedForm4(overrides: Partial<ToolValues> = {}): Promise<string> {
  const categoryId = await insertCategory("Resin", "3D Printing");
  const locationId = await insertLocation("MakerLab", "Resin Bench", "ML-RESIN-01");
  const toolId = await insertTool({
    slug: "form-4",
    name: "Form 4",
    description: "A production-grade resin printer.",
    categoryId,
    locationId,
    materials: ["Standard resin"],
    ppeRequired: ["Nitrile gloves"],
    tags: ["Resin", "SLA"],
    trainingRequired: true,
    useRestrictions: "Resin handling training required.",
    emergencyStop: "Lift the lid.",
    notes: "Ventilation must be running.",
    ...overrides,
  });
  await insertUnit({
    toolId,
    unitLabel: "Form 4 // A",
    serialNumber: "ML-F4-001",
    status: "in_use",
    condition: "excellent",
    dateAcquired: "2024-08-12",
  });
  await insertResource({ toolId, title: "Form 4 SOP", type: "SOP", url: "https://example.com/sop" });
  return toolId;
}

// ── listCatalogTools ────────────────────────────────────────────────

describe("listCatalogTools", () => {
  it("maps a tool, its category, location, unit and resource into the view model", async () => {
    await seedForm4();

    const [tool] = await listCatalogTools({ db });
    expect(tool).toMatchObject({
      slug: "form-4",
      name: "Form 4",
      category: "3D Printing",
      categorySub: "Resin",
      location: "MakerLab",
      zone: "Resin Bench",
      mapId: "ML-RESIN-01",
      status: "In Use",
      trainingLevel: "Intermediate",
      trainingLabel: "Resin handling training required.",
      shortDescription: "A production-grade resin printer.",
      materials: ["Standard resin"],
      ppe: ["Nitrile gloves"],
      emergencyStop: "Lift the lid.",
      notes: "Ventilation must be running.",
    });
    expect(tool.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(tool.units).toEqual([
      {
        id: expect.any(String),
        name: "Form 4 // A",
        serial: "ML-F4-001",
        status: "In Use",
        condition: "Excellent",
        location: "Resin Bench",
        dateAcquired: "2024-08-12",
      },
    ]);
    expect(tool.links).toEqual([
      {
        label: "Form 4 SOP",
        href: "https://example.com/sop",
        kind: "SOP",
        description: undefined,
      },
    ]);
  });

  it('carries the tool\'s starter questions, empty when it has none (amendment "Tool-specific starter questions")', async () => {
    await insertTool({ slug: "with-q", name: "A laser", starterQuestions: ["What can it cut?", "How thick can it go?"] });
    await insertTool({ slug: "without-q", name: "B saw" });
    const [withQuestions, without] = await listCatalogTools({ db });
    expect(withQuestions.starterQuestions).toEqual(["What can it cut?", "How thick can it go?"]);
    expect(without.starterQuestions).toEqual([]);
  });

  it("shows published tools only, never drafts or archived ones, ordered by name", async () => {
    await insertTool({ slug: "zeta", name: "Zeta mill" });
    await insertTool({ slug: "alpha", name: "Alpha saw" });
    await insertTool({ slug: "draft", name: "Draft router", published: false });
    await insertTool({ slug: "gone", name: "Archived lathe", archivedAt: new Date() });

    const names = (await listCatalogTools({ db })).map((tool) => tool.name);
    expect(names).toEqual(["Alpha saw", "Zeta mill"]);
  });

  it("includes drafts when the caller asks, but never an archived tool", async () => {
    await insertTool({ slug: "draft", name: "Draft router", published: false });
    await insertTool({ slug: "gone", name: "Archived lathe", archivedAt: new Date() });

    const names = (await listCatalogTools({ db, includeDrafts: true })).map((tool) => tool.name);
    expect(names).toEqual(["Draft router"]);
  });

  it("falls back to honest placeholders when a tool has no category, location or copy", async () => {
    await insertTool({ slug: "bare", name: "Bare tool" });

    const [tool] = await listCatalogTools({ db });
    expect(tool).toMatchObject({
      category: "Uncategorized",
      categorySub: "Other",
      location: "Unknown",
      zone: "Unknown",
      mapId: null,
      status: "Available",
      trainingLevel: "Beginner",
      trainingLabel: "Beginner orientation",
      shortDescription: "Catalog record pending description.",
      ppe: ["Check posted lab guidance"],
      imageSrc: "/tool-images/Bare%20tool.png",
      units: [],
      links: [],
    });
  });

  it("keeps each tool's units and resources to itself", async () => {
    const form4 = await seedForm4();
    const other = await insertTool({ slug: "other", name: "Other tool" });
    await insertUnit({ toolId: other, unitLabel: "Other // A", status: "available" });
    await insertResource({ toolId: other, title: "Other SOP", url: "https://example.com/other" });

    const bySlug = new Map((await listCatalogTools({ db })).map((tool) => [tool.slug, tool]));
    expect(bySlug.get("form-4")?.units.map((unit) => unit.name)).toEqual(["Form 4 // A"]);
    expect(bySlug.get("form-4")?.links.map((link) => link.href)).toEqual([
      "https://example.com/sop",
    ]);
    expect(bySlug.get("other")?.units.map((unit) => unit.name)).toEqual(["Other // A"]);
    expect(form4).not.toBe(other);
  });
});

// ── Images and links from attachments ───────────────────────────────

describe("attachments", () => {
  it("uses the lowest-position public photo as the tool image", async () => {
    const toolId = await seedForm4();
    await insertAttachment({
      ownerType: "tool",
      ownerId: toolId,
      position: 2,
      publicUrl: "https://blob.example.com/third.png",
    });
    await insertAttachment({
      ownerType: "tool",
      ownerId: toolId,
      position: 1,
      publicUrl: "https://blob.example.com/first.png",
    });

    const [tool] = await listCatalogTools({ db });
    expect(tool.imageSrc).toBe("https://blob.example.com/first.png");
  });

  it("skips a private photo and falls back to the bundled image", async () => {
    const toolId = await seedForm4();
    await insertAttachment({
      ownerType: "tool",
      ownerId: toolId,
      access: "private",
      publicUrl: "https://blob.example.com/private.png",
    });

    const [tool] = await listCatalogTools({ db });
    expect(tool.imageSrc).toBe("/tool-images/Form%204.png");
  });

  it("emits a link per resource file alongside the resource url", async () => {
    const toolId = await insertTool({ slug: "laser", name: "Laser" });
    const resourceId = await insertResource({
      toolId,
      title: "Manual",
      type: "Manual",
      url: "https://example.com/manual",
      notes: "Read section 4 first.",
    });
    await insertAttachment({
      ownerType: "resource",
      ownerId: resourceId,
      position: 0,
      publicUrl: "https://blob.example.com/manual.pdf",
      originalFilename: "manual.pdf",
    });

    const [tool] = await listCatalogTools({ db });
    expect(tool.links).toEqual([
      {
        label: "Manual",
        href: "https://example.com/manual",
        kind: "Manual",
        description: "Read section 4 first.",
      },
      {
        label: "Manual",
        href: "https://blob.example.com/manual.pdf",
        kind: "Manual",
        description: "Read section 4 first.",
      },
    ]);
  });

  /**
   * The regression: the editor's **Hide** control has to hide. It flips
   * `resources.published`, the panel tags the row "Hidden" and the assistant
   * stops reading it — so a tool page that still listed the internal SOP would
   * leave a document staff deliberately restricted world-readable, with every
   * surface but this one saying otherwise.
   */
  it("hides an unpublished resource from the tool page, because Hide has to hide", async () => {
    const toolId = await insertTool({ slug: "laser", name: "Laser" });
    await insertResource({
      toolId,
      title: "Internal SOP",
      url: "https://example.com/internal",
      published: false,
    });
    await insertResource({
      toolId,
      title: "Manual",
      url: "https://example.com/manual",
    });

    const [tool] = await listCatalogTools({ db });
    expect(tool.links.map((link) => link.href)).toEqual(["https://example.com/manual"]);
  });

  it("hides the files hanging off a hidden resource too", async () => {
    const toolId = await insertTool({ slug: "laser", name: "Laser" });
    const resourceId = await insertResource({
      toolId,
      title: "Internal SOP",
      published: false,
    });
    await insertAttachment({
      ownerType: "resource",
      ownerId: resourceId,
      publicUrl: "https://blob.example.com/internal-sop.pdf",
    });

    const [tool] = await listCatalogTools({ db });
    expect(tool.links).toEqual([]);
  });

  it("ignores attachments owned by another row entirely", async () => {
    const toolId = await seedForm4();
    const other = await insertTool({ slug: "other", name: "Other tool" });
    await insertAttachment({
      ownerType: "tool",
      ownerId: other,
      publicUrl: "https://blob.example.com/other.png",
    });

    const bySlug = new Map((await listCatalogTools({ db })).map((tool) => [tool.slug, tool]));
    expect(bySlug.get("form-4")?.imageSrc).toBe("/tool-images/Form%204.png");
    expect(bySlug.get("other")?.imageSrc).toBe("https://blob.example.com/other.png");
    expect(toolId).not.toBe(other);
  });
});

// ── Status and condition, from the stored vocabulary ────────────────

describe("unit status and condition from stored values", () => {
  it.each([
    ["available", "Available"],
    ["in_use", "In Use"],
    ["under_maintenance", "Offline"],
    ["out_of_service", "Offline"],
    ["retired", "Offline"],
  ] as const)("reads unit status %s as %s", async (stored, shown) => {
    const toolId = await insertTool({ slug: "s", name: "Status tool" });
    await insertUnit({ toolId, unitLabel: "A", status: stored, condition: "good" });

    const [tool] = await listCatalogTools({ db });
    expect(tool.units[0].status).toBe(shown);
  });

  it.each([
    ["excellent", "Excellent"],
    ["good", "Good"],
    ["fair", "Good"],
    ["new", "Good"],
    ["needs_repair", "Service Soon"],
    [null, "Good"],
  ] as const)("reads unit condition %s as %s", async (stored, shown) => {
    const toolId = await insertTool({ slug: "c", name: "Condition tool" });
    await insertUnit({ toolId, unitLabel: "A", status: "available", condition: stored });

    const [tool] = await listCatalogTools({ db });
    expect(tool.units[0].condition).toBe(shown);
  });

  it("covers every value the schema allows", () => {
    // A vocabulary that grows without this module growing with it would show
    // the new value as "Available" / "Good" without anyone noticing.
    expect([...UNIT_STATUS]).toEqual([
      "available",
      "in_use",
      "under_maintenance",
      "out_of_service",
      "retired",
    ]);
    expect([...UNIT_CONDITION]).toEqual(["excellent", "good", "fair", "needs_repair", "new"]);
  });

  it("lets maintenance and retirement override the stored condition", async () => {
    const toolId = await insertTool({ slug: "m", name: "Maintenance tool" });
    await insertUnit({
      toolId,
      unitLabel: "A",
      status: "under_maintenance",
      condition: "excellent",
    });
    await insertUnit({ toolId, unitLabel: "B", status: "retired", condition: "good" });

    const [tool] = await listCatalogTools({ db });
    expect(tool.units.map((unit) => unit.condition)).toEqual(["Service Soon", "Offline"]);
  });

  it("falls back to the asset tag, then to Unlisted, for a serial", async () => {
    const toolId = await insertTool({ slug: "sn", name: "Serial tool" });
    await insertUnit({ toolId, unitLabel: "A", assetTag: "ASSET-9", status: "available" });
    await insertUnit({ toolId, unitLabel: "B", status: "available" });

    const [tool] = await listCatalogTools({ db });
    expect(tool.units.map((unit) => unit.serial)).toEqual(["ASSET-9", "Unlisted"]);
  });
});

describe("tool status derivation", () => {
  it("is In Use when any unit is in use, whatever the others say", async () => {
    const toolId = await insertTool({ slug: "t", name: "Tool" });
    await insertUnit({ toolId, unitLabel: "A", status: "available" });
    await insertUnit({ toolId, unitLabel: "B", status: "in_use" });

    expect((await listCatalogTools({ db }))[0].status).toBe("In Use");
  });

  it("is Offline when every unit is offline", async () => {
    const toolId = await insertTool({ slug: "t", name: "Tool" });
    await insertUnit({ toolId, unitLabel: "A", status: "out_of_service" });
    await insertUnit({ toolId, unitLabel: "B", status: "retired" });

    expect((await listCatalogTools({ db }))[0].status).toBe("Offline");
  });

  it("is Training Required when training is required and no unit gates it", async () => {
    await insertTool({ slug: "t", name: "Tool", trainingRequired: true });

    expect((await listCatalogTools({ db }))[0].status).toBe("Training Required");
  });

  it("is Available when nothing gates it", async () => {
    const toolId = await insertTool({ slug: "t", name: "Tool" });
    await insertUnit({ toolId, unitLabel: "A", status: "available" });

    expect((await listCatalogTools({ db }))[0].status).toBe("Available");
  });
});

// ── Lookups ─────────────────────────────────────────────────────────

describe("findToolBySlug", () => {
  it("resolves a published tool and returns null for an unknown slug", async () => {
    await seedForm4();

    expect((await findToolBySlug("form-4", { db }))?.name).toBe("Form 4");
    expect(await findToolBySlug("nope", { db })).toBeNull();
  });

  it("hides a draft unless the caller passes includeDrafts", async () => {
    await insertTool({ slug: "draft", name: "Draft router", published: false });

    expect(await findToolBySlug("draft", { db })).toBeNull();
    expect((await findToolBySlug("draft", { db, includeDrafts: true }))?.name).toBe("Draft router");
  });

  it("hides an archived tool even with includeDrafts", async () => {
    await insertTool({ slug: "gone", name: "Archived lathe", archivedAt: new Date() });

    expect(await findToolBySlug("gone", { db, includeDrafts: true })).toBeNull();
  });
});

describe("findToolByIdOrSlug", () => {
  it("resolves the Postgres uuid capabilities pass back as tool.id", async () => {
    const toolId = await seedForm4();

    expect((await findToolByIdOrSlug(toolId, { db }))?.slug).toBe("form-4");
  });

  it("resolves a slug", async () => {
    await seedForm4();

    expect((await findToolByIdOrSlug("form-4", { db }))?.name).toBe("Form 4");
  });

  it("returns null for an unknown uuid and for free text, without a bad-cast error", async () => {
    await seedForm4();

    expect(await findToolByIdOrSlug("11111111-2222-3333-4444-555555555555", { db })).toBeNull();
    expect(await findToolByIdOrSlug("not a tool at all", { db })).toBeNull();
  });
});

describe("findToolByNotionPageId", () => {
  const dashed = "0f5e2c1a-4b6d-4e8f-9a0b-1c2d3e4f5a6b";
  const compact = "0f5e2c1a4b6d4e8f9a0b1c2d3e4f5a6b";

  it("matches the stored id whether the link carries dashes or not", async () => {
    await insertTool({ slug: "form-4", name: "Form 4", notionPageId: dashed });

    expect(await findToolByNotionPageId(dashed, { db })).toEqual({ slug: "form-4" });
    expect(await findToolByNotionPageId(compact, { db })).toEqual({ slug: "form-4" });
    expect(await findToolByNotionPageId(compact.toUpperCase(), { db })).toEqual({ slug: "form-4" });
  });

  it("matches an undashed stored id too, since the import is not the only writer", async () => {
    await insertTool({ slug: "form-4", name: "Form 4", notionPageId: compact });

    expect(await findToolByNotionPageId(dashed, { db })).toEqual({ slug: "form-4" });
  });

  it("returns null for an unknown id and for a slug", async () => {
    await seedForm4();

    expect(await findToolByNotionPageId(dashed, { db })).toBeNull();
    expect(await findToolByNotionPageId("form-4", { db })).toBeNull();
  });
});

describe("countPublishedTools", () => {
  it("counts published, non-archived tools only", async () => {
    await insertTool({ slug: "a", name: "A" });
    await insertTool({ slug: "b", name: "B" });
    await insertTool({ slug: "c", name: "C", published: false });
    await insertTool({ slug: "d", name: "D", archivedAt: new Date() });

    expect(await countPublishedTools({ db })).toBe(2);
  });

  it("is 0 on an empty catalogue", async () => {
    expect(await countPublishedTools({ db })).toBe(0);
  });
});

// ── The mapping functions on their own ──────────────────────────────

const toolRow: ToolRow = {
  id: "tool-id",
  slug: "form-4",
  name: "Form 4",
  description: null,
  materials: [],
  ppeRequired: [],
  tags: [],
  trainingRequired: false,
  useRestrictions: null,
  emergencyStop: null,
  notes: null,
  starterQuestions: [],
  categoryName: null,
  categoryGroup: null,
  room: "MakerLab",
  zone: "Resin Bench",
  mapTag: null,
};

const unitRow: UnitRow = {
  id: "unit-id",
  toolId: "tool-id",
  unitLabel: "Form 4 // A",
  serialNumber: null,
  assetTag: null,
  status: "available",
  condition: null,
  dateAcquired: null,
};

function file(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    ownerType: "tool",
    ownerId: "tool-id",
    position: 0,
    access: "public",
    publicUrl: "https://blob.example.com/a.png",
    originalFilename: null,
    ...overrides,
  };
}

describe("toToolStatus", () => {
  it("maps stored statuses, then falls through to the training gate", () => {
    expect(toToolStatus("in_use", false)).toBe("In Use");
    expect(toToolStatus("under_maintenance", false)).toBe("Offline");
    expect(toToolStatus("out_of_service", false)).toBe("Offline");
    expect(toToolStatus("retired", false)).toBe("Offline");
    expect(toToolStatus("available", true)).toBe("Training Required");
    expect(toToolStatus("available", false)).toBe("Available");
    expect(toToolStatus(undefined, true)).toBe("Training Required");
    expect(toToolStatus(null, false)).toBe("Available");
  });

  it("does not accept the Title-case values Notion used to store", () => {
    expect(toToolStatus("In Use", false)).toBe("Available");
    expect(toToolStatus("Out of Service", false)).toBe("Available");
  });
});

describe("toCondition", () => {
  it("lets the status override the condition", () => {
    expect(toCondition("excellent", "out_of_service")).toBe("Offline");
    expect(toCondition("excellent", "retired")).toBe("Offline");
    expect(toCondition("excellent", "under_maintenance")).toBe("Service Soon");
  });

  it("maps every stored condition", () => {
    expect(toCondition("excellent", "available")).toBe("Excellent");
    expect(toCondition("good", "available")).toBe("Good");
    expect(toCondition("fair", "available")).toBe("Good");
    expect(toCondition("new", "available")).toBe("Good");
    expect(toCondition("needs_repair", "available")).toBe("Service Soon");
    expect(toCondition(null, "available")).toBe("Good");
  });
});

describe("toMakerLabUnit", () => {
  it("names an unlabelled unit after its tool and locates it by zone", () => {
    const unit = toMakerLabUnit({ ...unitRow, unitLabel: "" }, toolRow);
    expect(unit.name).toBe("Form 4 // Unit");
    expect(unit.location).toBe("Resin Bench");
  });

  it("falls back to the room, then to Unknown, when there is no zone", () => {
    expect(toMakerLabUnit(unitRow, { ...toolRow, zone: null }).location).toBe("MakerLab");
    expect(toMakerLabUnit(unitRow, { ...toolRow, zone: null, room: null }).location).toBe("Unknown");
  });
});

describe("deriveTrainingLevel / deriveTrainingLabel", () => {
  it("reads Advanced out of the restrictions or the tags", () => {
    expect(
      deriveTrainingLevel({ ...toolRow, useRestrictions: "Authorized users only." })
    ).toBe("Advanced");
    expect(deriveTrainingLevel({ ...toolRow, tags: ["Advanced", "Laser"] })).toBe("Advanced");
  });

  it("is Intermediate when training is required and nothing says advanced", () => {
    expect(deriveTrainingLevel({ ...toolRow, trainingRequired: true })).toBe("Intermediate");
  });

  it("is Beginner otherwise", () => {
    expect(deriveTrainingLevel(toolRow)).toBe("Beginner");
    expect(deriveTrainingLabel(toolRow)).toBe("Beginner orientation");
  });

  it("prefers the restriction text as the label, then names the level", () => {
    expect(
      deriveTrainingLabel({
        ...toolRow,
        trainingRequired: true,
        useRestrictions: "Resin handling training required.",
      })
    ).toBe("Resin handling training required.");
    expect(deriveTrainingLabel({ ...toolRow, trainingRequired: true })).toBe(
      "Intermediate checkout required"
    );
  });
});

describe("indexAttachments / toolImageSrc", () => {
  it("groups by owner and sorts by position, whatever order the rows arrive in", () => {
    const index = indexAttachments([
      file({ position: 2, publicUrl: "c.png" }),
      file({ position: 0, publicUrl: "a.png" }),
      file({ ownerType: "resource", ownerId: "res-id", publicUrl: "r.png" }),
      file({ position: 1, publicUrl: "b.png" }),
    ]);

    expect(index.get("tool:tool-id")?.map((row) => row.publicUrl)).toEqual([
      "a.png",
      "b.png",
      "c.png",
    ]);
    expect(index.get("resource:res-id")?.map((row) => row.publicUrl)).toEqual(["r.png"]);
  });

  it("drops an attachment that is not owned by anything yet", () => {
    expect(indexAttachments([file({ ownerType: null, ownerId: null })]).size).toBe(0);
  });

  it("falls back to the bundled photo when there is no public file", () => {
    expect(toolImageSrc(toolRow, [])).toBe("/tool-images/Form%204.png");
    expect(toolImageSrc(toolRow, [file({ access: "private" })])).toBe("/tool-images/Form%204.png");
    expect(toolImageSrc(toolRow, [file({ publicUrl: null })])).toBe("/tool-images/Form%204.png");
  });
});

describe("resourceLinks", () => {
  const resourceRow: ResourceRow = {
    id: "res-id",
    toolId: "tool-id",
    title: "Form 4 SOP",
    type: "SOP",
    url: null,
    notes: null,
  };

  it("emits nothing for a resource with neither a url nor a file", () => {
    expect(resourceLinks([resourceRow])).toEqual([]);
  });

  it("labels a file link with the resource title, then the filename, then the type", () => {
    const files = indexAttachments([
      file({ ownerType: "resource", ownerId: "res-id", originalFilename: "sop.pdf" }),
    ]);

    expect(resourceLinks([resourceRow], files)[0].label).toBe("Form 4 SOP");
    expect(resourceLinks([{ ...resourceRow, title: "" }], files)[0].label).toBe("sop.pdf");
    expect(
      resourceLinks(
        [{ ...resourceRow, title: "" }],
        indexAttachments([file({ ownerType: "resource", ownerId: "res-id" })])
      )[0].label
    ).toBe("SOP");
  });

  it("never links a private file", () => {
    const files = indexAttachments([
      file({ ownerType: "resource", ownerId: "res-id", access: "private" }),
    ]);
    expect(resourceLinks([resourceRow], files)).toEqual([]);
  });

  it("calls an untyped resource a Resource", () => {
    const links = resourceLinks([
      { ...resourceRow, title: "", type: null, url: "https://example.com/x" },
    ]);
    expect(links[0]).toMatchObject({ label: "Resource", kind: "Resource" });
  });

  describe("an archived manual", () => {
    const SOURCE = "https://maker.test/form-4-manual.pdf";
    const manual: ResourceRow = { ...resourceRow, title: "Form 4 manual", type: "Manual", url: SOURCE };
    const archive = (url: string, publicUrl = "https://blob.test/manuals/form-4.pdf") =>
      file({
        ownerType: "resource",
        ownerId: "res-id",
        publicUrl,
        originalFilename: "form-4-manual.pdf",
        sourceKey: manualSourceKey("res-id", url),
      });

    it("links the copy once, with the manufacturer's link kept as the source", () => {
      expect(resourceLinks([manual], indexAttachments([archive(SOURCE)]))).toEqual([
        {
          label: "Form 4 manual",
          href: "https://blob.test/manuals/form-4.pdf",
          sourceHref: SOURCE,
          kind: "Manual",
          description: undefined,
        },
      ]);
    });

    it("falls back to the source link when there is no copy", () => {
      expect(resourceLinks([manual])).toEqual([
        { label: "Form 4 manual", href: SOURCE, kind: "Manual", description: undefined },
      ]);
    });

    it("drops a stale copy of a link the resource no longer carries, rather than listing it", () => {
      const links = resourceLinks([manual], indexAttachments([archive("https://maker.test/old.pdf", "https://blob.test/old.pdf")]));
      expect(links.map((link) => link.href)).toEqual([SOURCE]);
    });

    it("still lists an uploaded file beside the archived link", () => {
      const files = indexAttachments([
        archive(SOURCE),
        file({ ownerType: "resource", ownerId: "res-id", publicUrl: "https://blob.test/quick-start.pdf", position: 1 }),
      ]);
      expect(resourceLinks([manual], files).map((link) => link.href)).toEqual([
        "https://blob.test/manuals/form-4.pdf",
        "https://blob.test/quick-start.pdf",
      ]);
    });
  });
});

describe("localToolImage", () => {
  it("encodes the name and keeps a slash out of the path", () => {
    expect(localToolImage("Form 4")).toBe("/tool-images/Form%204.png");
    expect(localToolImage("Bantam/Othermill")).toBe("/tool-images/Bantam_Othermill.png");
  });
});
