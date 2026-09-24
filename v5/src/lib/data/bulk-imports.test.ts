// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { bulkImports, pendingTools, researchRequests, resources, tools, units, user } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ImportItem } from "../import/types";
import type { ResearchResult } from "../research/result";
import {
  addImportItems,
  chargeSuggestionAllowance,
  createBulkImport,
  failBulkImport,
  getBulkImport,
  listBulkImports,
  mergeImportRows,
  setImportHints,
  setNameSuggestion,
} from "./bulk-imports";
import {
  approvePendingAsUnit,
  approvePendingTool,
  completeResearch,
  countResearchRequestedSince,
  getPendingTool,
  listPendingTools,
  markResearching,
  queueForResearch,
  updatePendingTool,
  type ApprovalFields,
} from "./pending-tools";
import { grantResearchAllowance, listActiveAllowances, researchLimitFor } from "./research-allowances";

/**
 * Bulk intake's data layer against a real (in-process) Postgres (bulk intake
 * spec §4, §10 "Integration"): an import makes identified pending items in its
 * own batch, duplicates within the import are flagged, quantities and serials
 * become units at approval, lab documents survive a research rerun and become
 * `lab_document` resources that nothing fetches, and the setup allowance lifts
 * the ceiling the research ledger is counted against.
 */

let db: Db;
const OWNER = "import-owner";
const APPROVER = "import-approver";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values([
    { id: OWNER, name: "Niti", email: "import-owner@cornell.edu", role: "admin" },
    { id: APPROVER, name: "Luis", email: "import-approver@cornell.edu", role: "super_admin" },
  ]);
});

beforeEach(async () => {
  await db.delete(researchRequests);
  await db.delete(pendingTools);
  await db.delete(bulkImports);
  await db.delete(tools);
});

function item(name: string, extra: Partial<ImportItem> = {}): ImportItem {
  return {
    name,
    brand: null,
    categoryHint: null,
    locationHint: null,
    quantity: 1,
    serials: [],
    notes: null,
    links: [],
    labDocs: [],
    sourceRow: null,
    ...extra,
  };
}

async function newImport(status: "mapping" | "parsing" = "parsing") {
  return createBulkImport(
    { createdBy: OWNER, sourceKind: "paste", format: "list", sourceName: null, sourceText: "…", status },
    { db }
  );
}

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Formlabs Form 2",
    description: "An SLA printer.",
    specs: [],
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "SLA", group: null, existingId: null },
    resources: [{ title: "Manual", url: "https://formlabs.example/form2.pdf", type: "Manual" }],
    droppedLinks: [],
    sourceUrls: ["https://formlabs.example/form-2"],
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

const FIELDS: ApprovalFields = {
  name: "Formlabs Form 2",
  description: "An SLA printer.",
  categoryId: null,
  locationId: null,
  materials: [],
  ppeRequired: [],
  tags: [],
  trainingRequired: true,
  useRestrictions: null,
  serialNumber: null,
};

/** Research an item the way the workflow does, so it can be approved. */
async function researched(id: string, result = research()) {
  await queueForResearch([id], { requestedBy: OWNER }, { db });
  await markResearching(id, { db });
  expect(await completeResearch(id, result, { db })).toBe(true);
}

describe("an import's rows", () => {
  it("become identified pending items in the import's batch, with import_id and source row", async () => {
    const created = await newImport();
    const written = await addImportItems(created.id, { items: [item("Form 2", { sourceRow: 2 }), item("Heat gun", { sourceRow: 3 })], rowCount: 2 }, { db });
    expect(written).toMatchObject({ ok: true, itemCount: 2, duplicateCount: 0 });

    const rows = await listPendingTools({ importId: created.id }, { db });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({ status: "identified", importId: created.id, batchId: created.batchId, createdBy: OWNER });
    }
    expect(rows.map((row) => row.sourceRow).sort()).toEqual([2, 3]);
    expect(await getBulkImport(created.id, { db })).toMatchObject({ status: "ready", itemCount: 2, rowCount: 2 });
  });

  it("flags a row that repeats an earlier row of the same import, and one that matches the inventory", async () => {
    await db.insert(tools).values({ name: "Trotec Speedy 400", slug: "trotec-speedy-400-import", published: true });
    const created = await newImport();
    const written = await addImportItems(
      created.id,
      { items: [item("Form 2", { sourceRow: 2 }), item("Trotec Speedy 400", { sourceRow: 3 }), item("Form-2", { sourceRow: 4 })], rowCount: 3 },
      { db }
    );
    expect(written).toMatchObject({ ok: true, duplicateCount: 2 });
    const rows = await listPendingTools({ importId: created.id }, { db });
    const byRow = new Map(rows.map((row) => [row.sourceRow, row]));
    expect(byRow.get(2)?.duplicateOf).toBeNull();
    expect(byRow.get(3)?.duplicateOf).toMatchObject({ kind: "tool", name: "Trotec Speedy 400" });
    expect(byRow.get(4)?.duplicateOf).toMatchObject({ kind: "pending", id: byRow.get(2)?.id });
  });

  it("makes rows once: a second confirm finds the import ready", async () => {
    const created = await newImport("mapping");
    expect((await addImportItems(created.id, { items: [item("Drill")], rowCount: 1 }, { db })).ok).toBe(true);
    expect(await addImportItems(created.id, { items: [item("Drill")], rowCount: 1 }, { db })).toEqual({ ok: false, reason: "not_editable" });
    expect(await listPendingTools({ importId: created.id }, { db })).toHaveLength(1);
  });

  it("an import with nothing in it fails as no_items, and a failed one is not failed again", async () => {
    const created = await newImport();
    await addImportItems(created.id, { items: [], rowCount: 5 }, { db });
    expect(await getBulkImport(created.id, { db })).toMatchObject({ status: "failed", parseError: "no_items", rowCount: 5 });
    expect(await failBulkImport(created.id, "later", { db })).toBe(false);
    expect((await listBulkImports({}, { db }))[0]).toMatchObject({ id: created.id, createdByName: "Niti" });
  });

  it("keeps quantity, serials, lab documents, links and notes on the row", async () => {
    const created = await newImport();
    await addImportItems(
      created.id,
      {
        items: [
          item("Form 2", {
            quantity: 1,
            serials: ["F1", "F2"],
            labDocs: [{ title: "SOP", url: "https://docs.google.com/d/1" }],
            links: [{ url: "https://formlabs.example/form-2" }],
            notes: "Back room — ask Luis",
          }),
        ],
        rowCount: 1,
      },
      { db }
    );
    const [row] = await listPendingTools({ importId: created.id }, { db });
    expect(row).toMatchObject({
      quantity: 2,
      serials: ["F1", "F2"],
      serialNumber: "F1",
      labDocs: [{ title: "SOP", url: "https://docs.google.com/d/1" }],
      links: [{ url: "https://formlabs.example/form-2" }],
      notes: "Back room — ask Luis",
    });
  });
});

describe("the review table's writes", () => {
  it("sets a category on the chosen rows of this import only", async () => {
    const created = await newImport();
    const other = await newImport();
    const [a, b] = ((await addImportItems(created.id, { items: [item("Drill"), item("Saw")], rowCount: 2 }, { db })) as { itemIds: string[] }).itemIds;
    const [c] = ((await addImportItems(other.id, { items: [item("Lathe")], rowCount: 1 }, { db })) as { itemIds: string[] }).itemIds;
    const changed = await setImportHints(created.id, [a, c], { categoryHint: "Wood shop" }, { db });
    expect(changed).toEqual([a]);
    expect((await getPendingTool(a, { db }))?.categoryHint).toBe("Wood shop");
    expect((await getPendingTool(b, { db }))?.categoryHint).toBeNull();
    expect((await getPendingTool(c, { db }))?.categoryHint).toBeNull();
  });

  it("merges a row listed twice into the earlier one as more units", async () => {
    const created = await newImport();
    const written = await addImportItems(
      created.id,
      { items: [item("Form 2", { serials: ["F1"] }), item("Form 2", { quantity: 2, serials: ["F2"] })], rowCount: 2 },
      { db }
    );
    const [first, second] = (written as { itemIds: string[] }).itemIds;
    expect(await mergeImportRows(created.id, { sourceId: second, targetId: first }, { db })).toEqual({ ok: true, quantity: 3 });
    expect(await getPendingTool(first, { db })).toMatchObject({ quantity: 3, serials: ["F1", "F2"] });
    expect((await getPendingTool(second, { db }))?.status).toBe("discarded");
  });

  it("accepting a suggested name re-runs the duplicate check, against the rest of the import too", async () => {
    const created = await newImport();
    const written = await addImportItems(created.id, { items: [item("Formlabs Form 2"), item("Form 2 printer")], rowCount: 2 }, { db });
    const [, vague] = (written as { itemIds: string[] }).itemIds;
    await setNameSuggestion(
      vague,
      { canonicalName: "Formlabs Form 2", brand: "Formlabs", confidence: "exact", sourceUrl: null, suggestedAt: new Date().toISOString() },
      { db }
    );
    const accepted = await updatePendingTool(vague, { name: "Formlabs Form 2", brand: "Formlabs", clearNameSuggestion: true }, { db });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.item.nameSuggestion).toBeNull();
    expect(accepted.item.duplicateOf).toMatchObject({ kind: "pending", name: "Formlabs Form 2" });
  });

  it("refuses a quantity below the serials", async () => {
    const created = await newImport();
    const [id] = ((await addImportItems(created.id, { items: [item("Drill", { serials: ["D1", "D2"] })], rowCount: 1 }, { db })) as { itemIds: string[] }).itemIds;
    expect(await updatePendingTool(id, { quantity: 1 }, { db })).toEqual({ ok: false, reason: "invalid_field" });
    expect((await updatePendingTool(id, { quantity: 4 }, { db })).ok).toBe(true);
  });
});

describe("lab documents and units through research and approval (§3.4, §10)", () => {
  it("lab documents survive a research rerun, and approval makes lab_document resources and quantity units", async () => {
    const created = await newImport();
    const [id] = (
      (await addImportItems(
        created.id,
        {
          items: [
            item("Form 2", {
              quantity: 3,
              serials: ["F1", "F2"],
              labDocs: [{ title: "SOP", url: "https://docs.google.com/d/sop" }],
              links: [{ url: "https://formlabs.example/extra.pdf" }, { url: "https://formlabs.example/form2.pdf" }],
            }),
          ],
          rowCount: 1,
        },
        { db }
      )) as { itemIds: string[] }
    ).itemIds;

    await researched(id);
    await researched(id, research({ description: "Researched again." }));
    expect((await getPendingTool(id, { db }))?.labDocs).toEqual([{ title: "SOP", url: "https://docs.google.com/d/sop" }]);

    // The preliminary page starts the serial box at the first serial.
    const approved = await approvePendingTool({ id, actorUserId: APPROVER, publish: false, fields: { ...FIELDS, serialNumber: "F1" } }, { db });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    const toolUnits = await db.select().from(units).where(eq(units.toolId, approved.toolId));
    expect(toolUnits.map((unit) => [unit.unitLabel, unit.serialNumber]).sort()).toEqual([
      ["Formlabs Form 2 #1", "F1"],
      ["Formlabs Form 2 #2", "F2"],
      ["Formlabs Form 2 #3", null],
    ]);

    const toolResources = await db.select().from(resources).where(eq(resources.toolId, approved.toolId));
    const byUrl = new Map(toolResources.map((resource) => [resource.url, resource]));
    // Research's manual, the import's extra link (its duplicate of research's is not repeated), the SOP.
    expect(toolResources).toHaveLength(3);
    expect(byUrl.get("https://docs.google.com/d/sop")).toMatchObject({ title: "SOP", type: "Other", origin: "lab_document" });
    expect(byUrl.get("https://formlabs.example/extra.pdf")).toMatchObject({ type: "Manual", origin: null });
    // Nothing may fetch the lab document: it is not handed to the manual archive.
    expect(approved.resourceIds).toHaveLength(2);
    expect(approved.resourceIds).not.toContain(byUrl.get("https://docs.google.com/d/sop")?.id);
  });

  it("keeps only the import links the approver left ticked, and refuses one the item never had", async () => {
    const created = await newImport();
    const [id] = (
      (await addImportItems(created.id, { items: [item("Form 2", { links: [{ url: "https://a.example/one" }, { url: "https://a.example/two" }] })], rowCount: 1 }, { db })) as {
        itemIds: string[];
      }
    ).itemIds;
    await researched(id);
    expect(
      await approvePendingTool({ id, actorUserId: APPROVER, publish: false, fields: { ...FIELDS, importLinkUrls: ["https://evil.example"] } }, { db })
    ).toEqual({ ok: false, reason: "invalid_field" });
    const approved = await approvePendingTool(
      { id, actorUserId: APPROVER, publish: false, fields: { ...FIELDS, importLinkUrls: ["https://a.example/two"] } },
      { db }
    );
    if (!approved.ok) throw new Error("approval refused");
    const urls = (await db.select().from(resources).where(eq(resources.toolId, approved.toolId))).map((r) => r.url).sort();
    expect(urls).toEqual(["https://a.example/two", "https://formlabs.example/form2.pdf"]);
  });

  it("an add-unit item with quantity 2 becomes two more units, and its lab document joins the tool", async () => {
    const [tool] = await db.insert(tools).values({ name: "Trotec Speedy 400", slug: "trotec-add-unit", published: true }).returning();
    await db.insert(units).values({ toolId: tool.id, unitLabel: "Trotec Speedy 400 #1" });
    const created = await newImport();
    const [id] = (
      (await addImportItems(
        created.id,
        { items: [item("Trotec Speedy 400", { quantity: 2, labDocs: [{ title: "Laser SOP", url: "https://docs.google.com/d/laser" }] })], rowCount: 1 },
        { db }
      )) as { itemIds: string[] }
    ).itemIds;
    await updatePendingTool(id, { duplicateResolution: "add_unit" }, { db });
    await db.update(pendingTools).set({ status: "researched" }).where(eq(pendingTools.id, id));

    const added = await approvePendingAsUnit({ id, actorUserId: APPROVER }, { db });
    expect(added.ok).toBe(true);
    const labels = (await db.select().from(units).where(eq(units.toolId, tool.id))).map((unit) => unit.unitLabel).sort();
    expect(labels).toEqual(["Trotec Speedy 400 #1", "Trotec Speedy 400 #2", "Trotec Speedy 400 #3"]);
    const [doc] = await db.select().from(resources).where(eq(resources.toolId, tool.id));
    expect(doc).toMatchObject({ title: "Laser SOP", origin: "lab_document" });
  });
});

describe("the setup allowance and the Suggest names charge (§3.3, §4.2)", () => {
  it("adds a running grant to the daily 100, and an expired one to nothing", async () => {
    expect(await researchLimitFor(OWNER, { db })).toBe(100);
    await grantResearchAllowance({ userId: OWNER, extraItems: 400, days: 7, grantedBy: APPROVER }, { db });
    await grantResearchAllowance(
      { userId: OWNER, extraItems: 50, days: 1, grantedBy: APPROVER },
      { db, now: new Date(Date.now() - 3 * 24 * 60 * 60_000) }
    );
    expect(await researchLimitFor(OWNER, { db })).toBe(500);
    expect((await listActiveAllowances([OWNER], { db })).map((grant) => grant.extraItems)).toEqual([400]);
  });

  it("charges a quarter of an item per suggestion, under the ceiling", async () => {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    expect(await chargeSuggestionAllowance({ userId: APPROVER, ledgerRows: 3, limit: 4, since }, { db })).toEqual({ ok: true, charged: 3 });
    expect(await countResearchRequestedSince(APPROVER, since, { db })).toBe(3);
    expect(await chargeSuggestionAllowance({ userId: APPROVER, ledgerRows: 2, limit: 4, since }, { db })).toEqual({
      ok: false,
      reason: "daily_limit",
      remaining: 1,
    });
  });

  it("stores a suggestion only while the item is still identified", async () => {
    const created = await newImport();
    const [id] = ((await addImportItems(created.id, { items: [item("Form 2")], rowCount: 1 }, { db })) as { itemIds: string[] }).itemIds;
    const suggestion = { canonicalName: "Formlabs Form 2", brand: "Formlabs", confidence: "exact" as const, sourceUrl: null, suggestedAt: "2026-09-24T00:00:00.000Z" };
    expect(await setNameSuggestion(id, suggestion, { db })).toBe(true);
    await queueForResearch([id], { requestedBy: OWNER }, { db });
    expect(await setNameSuggestion(id, suggestion, { db })).toBe(false);
  });
});
