import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { pendingTools, tools, units, user } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ResearchResult } from "../research/result";
import { listCatalogTools } from "./catalog";
import { findDuplicate } from "./duplicates";
import { approvePendingTool, createPendingBatch, type ApprovalFields } from "./pending-tools";
import { findToolForEditor, updateTool } from "./tools";

/**
 * A tool's two names on Postgres (tool display names spec 2026-09-24, §4,
 * §5.3, §5.6): approval copies both, the editor's save holds the display name
 * to its cap, the catalogue carries the official name, and the duplicate check
 * matches it.
 */

let db: Db;
const OWNER = "names-owner";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: OWNER, name: "Owner", email: "names-owner@cornell.edu" });
});

beforeEach(async () => {
  await db.delete(pendingTools);
  await db.delete(tools);
});

const RESEARCH: ResearchResult = {
  canonicalName: "Makita 196094-2 Compact Router Plunge Base",
  displayName: "Makita Plunge Base",
  description: "A plunge base for the compact router.",
  specs: [],
  materials: [],
  ppeRequired: [],
  tags: [],
  trainingRequired: false,
  useRestrictions: null,
  category: { name: "Routers", group: "Wood Shop", existingId: null },
  resources: [],
  droppedLinks: [],
  sourceUrls: ["https://makitatools.com/196094-2"],
  evidence: {
    userStatedModel: true,
    modelPlateRead: null,
    manufacturerPageFound: true,
    manualFound: false,
    specsFromSource: true,
    categoryOnly: false,
  },
  confidence: { level: "high", basis: [], unknowns: [] },
};

function fields(overrides: Partial<ApprovalFields> = {}): ApprovalFields {
  return {
    name: "Makita Plunge Base",
    officialName: "Makita 196094-2 Compact Router Plunge Base",
    description: "A plunge base.",
    categoryId: null,
    locationId: null,
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: false,
    useRestrictions: null,
    serialNumber: null,
    ...overrides,
  };
}

async function researchedItem(): Promise<string> {
  const batch = await createPendingBatch({ createdBy: OWNER, items: [{ name: "Makita plunge base 196094-2" }] }, { db });
  const id = batch.items[0].id;
  await db.update(pendingTools).set({ status: "researched", research: RESEARCH }).where(eq(pendingTools.id, id));
  return id;
}

async function toolRow(id: string) {
  const [row] = await db.select().from(tools).where(eq(tools.id, id));
  return row;
}

describe("approval (§5.3)", () => {
  it("writes the display name and the official name, and names the unit by the display name", async () => {
    const result = await approvePendingTool({ id: await researchedItem(), actorUserId: OWNER, publish: true, fields: fields() }, { db });
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    const row = await toolRow(result.toolId);
    expect(row.name).toBe("Makita Plunge Base");
    expect(row.officialName).toBe("Makita 196094-2 Compact Router Plunge Base");
    // The slug is derived from the display name, once, as ever.
    expect(row.slug).toBe("makita-plunge-base");
    const [unit] = await db.select().from(units).where(eq(units.toolId, result.toolId));
    expect(unit.unitLabel).toBe("Makita Plunge Base #1");
  });

  it("stores no official name for a blank one, or the display name spelled again", async () => {
    const blank = await approvePendingTool(
      { id: await researchedItem(), actorUserId: OWNER, publish: true, fields: fields({ officialName: "  " }) },
      { db }
    );
    if (!blank.ok) throw new Error("refused");
    expect((await toolRow(blank.toolId)).officialName).toBeNull();

    await db.delete(tools);
    const same = await approvePendingTool(
      { id: await researchedItem(), actorUserId: OWNER, publish: true, fields: fields({ officialName: "makita plunge-base" }) },
      { db }
    );
    if (!same.ok) throw new Error("refused");
    expect((await toolRow(same.toolId)).officialName).toBeNull();
  });

  it("refuses a display name over the 40-character cap, and writes nothing", async () => {
    const result = await approvePendingTool(
      { id: await researchedItem(), actorUserId: OWNER, publish: true, fields: fields({ name: "Makita 196094-2 Compact Router Plunge Base" }) },
      { db }
    );
    expect(result).toEqual({ ok: false, reason: "invalid_field" });
    expect(await db.select().from(tools)).toEqual([]);
  });
});

describe("the editor's save (§6)", () => {
  async function tool(): Promise<string> {
    const [row] = await db
      .insert(tools)
      .values({ slug: "festool-575267", name: "Festool 575267 Dust Extractor CT Midi Hepa", published: true })
      .returning({ id: tools.id });
    return row.id;
  }

  it("writes both names, and an emptied official name clears it", async () => {
    const id = await tool();
    const before = await findToolForEditor(id, { db });
    const saved = await updateTool(
      id,
      { name: "Festool Dust Extractor", officialName: " Festool 575267 Dust Extractor CT Midi Hepa " },
      before!.revision,
      { db }
    );
    if (!saved.ok) throw new Error(saved.reason);
    expect(await findToolForEditor(id, { db })).toMatchObject({
      name: "Festool Dust Extractor",
      officialName: "Festool 575267 Dust Extractor CT Midi Hepa",
      slug: "festool-575267",
    });

    const cleared = await updateTool(id, { officialName: "" }, saved.revision, { db });
    if (!cleared.ok) throw new Error(cleared.reason);
    expect((await findToolForEditor(id, { db }))?.officialName).toBeNull();
  });

  it("refuses a display name over the cap as invalid_field", async () => {
    const id = await tool();
    const before = await findToolForEditor(id, { db });
    expect(await updateTool(id, { name: "x".repeat(41) }, before!.revision, { db })).toEqual({ ok: false, reason: "invalid_field" });
  });
});

describe("reading and matching (§5.6)", () => {
  it("carries the official name into the catalogue", async () => {
    await db.insert(tools).values({ slug: "makita-plunge-base", name: "Makita Plunge Base", officialName: "Makita 196094-2 Compact Router Plunge Base", published: true });
    const [tool] = await listCatalogTools({ db });
    expect(tool).toMatchObject({ name: "Makita Plunge Base", officialName: "Makita 196094-2 Compact Router Plunge Base" });
  });

  it("finds a duplicate by its official name", async () => {
    await db.insert(tools).values({ slug: "makita-plunge-base", name: "Makita Plunge Base", officialName: "Makita 196094-2 Compact Router Plunge Base", published: true });
    expect(await findDuplicate({ name: "196094-2 Compact Router Plunge Base", brand: "Makita" }, { db })).toMatchObject({
      kind: "tool",
      name: "Makita Plunge Base",
    });
  });
});
