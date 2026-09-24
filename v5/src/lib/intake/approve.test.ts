// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

// A database that answers the *second* statement with an error — see
// `inventory/tool-state.audit.test.ts`. `vi.hoisted` because the factory runs
// before module scope exists.
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (event: Parameters<typeof actual.recordAuditEvent>[0]) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event);
    },
  };
});

// The mirror trigger has its own tests; here it is only asked whether it was
// called — after a committed approval, never after a refused one.
const mirror = vi.hoisted(() => ({ requestMirrorPush: vi.fn() }));

vi.mock("../mirror/trigger", () => ({ requestMirrorPush: mirror.requestMirrorPush }));

// The manual archive is mocked one layer down, at the module that calls the
// Workflow SDK's `start()`, so the real trigger's never-throw rule is what the
// start-failure case exercises.
const manuals = vi.hoisted(() => ({ startManualArchive: vi.fn() }));

vi.mock("../manuals/start", () => ({ startManualArchive: manuals.startManualArchive }));

import { revalidateTag } from "next/cache";
import { eq } from "drizzle-orm";
import { seedUser } from "../../../test/utils/session";
import {
  completeResearch,
  createPendingBatch,
  getPendingTool,
  markReadyAsUnit,
  markResearching,
  queueForResearch,
  updatePendingTool,
  type ApprovalFields,
} from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { auditEvents, resources, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ResearchResult } from "../research/result";
import { CATALOG_TAG } from "../revalidate";
import { addUnitAndRecord, approveAndRecord } from "./approve";

/**
 * Approval composed with what it owes afterwards (spec §5.4 step 11, §4.11,
 * Article 5).
 *
 * `pending-tools.approve.test.ts` proves the transaction; this proves the two
 * duties after it: the trail records who approved it and, when it went public,
 * that it was published — and the catalogue cache is told. A refusal owes
 * neither, and a lost audit event is still a success, because the tool exists.
 */

let db: Db;
let approver: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.mocked(revalidateTag).mockClear();
  mirror.requestMirrorPush.mockReset().mockResolvedValue(undefined);
  manuals.startManualArchive.mockReset().mockResolvedValue(true);
  audit.failing = false;
  db = await getDb();
  approver = (await seedUser({ email: "luis@cornell.edu", role: "admin" })).id;
});

afterEach(() => {
  audit.failing = false;
  resetDbForTests();
});

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Bambu Lab P1S",
    description: "An enclosed FDM printer.",
    specs: [],
    materials: ["PLA"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "FDM", group: "3D Printing", existingId: null },
    resources: [{ title: "Manual", url: "https://example.com/p1s.pdf", type: "Manual" }],
    droppedLinks: [],
    sourceUrls: ["https://example.com/p1s"],
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

const LOW: Partial<ResearchResult> = {
  evidence: {
    userStatedModel: false,
    modelPlateRead: null,
    manufacturerPageFound: false,
    manualFound: false,
    specsFromSource: false,
    categoryOnly: true,
  },
  confidence: { level: "low", basis: [], unknowns: [] },
};

function fields(overrides: Partial<ApprovalFields> = {}): ApprovalFields {
  return {
    name: "Bambu Lab P1S",
    description: "An enclosed FDM printer.",
    categoryId: null,
    newCategory: { name: "FDM", group: "3D Printing" },
    locationId: null,
    materials: ["PLA"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    serialNumber: "P1S-001",
    ...overrides,
  };
}

/** An item taken the whole way through research, the way the workflow does. */
async function researchedItem(result: ResearchResult = research()): Promise<string> {
  const batch = await createPendingBatch({
    createdBy: approver,
    items: [{ name: "Bambu Lab P1S" }],
  });
  const id = batch.items[0].id;
  expect(await queueForResearch([id], { requestedBy: approver })).toEqual([id]);
  expect(await markResearching(id)).not.toBeNull();
  expect(await completeResearch(id, result)).toBe(true);
  return id;
}

/** An item that matched the seeded Form 4 and was resolved as another unit. */
async function unitItem(serialNumber: string): Promise<string> {
  const batch = await createPendingBatch({
    createdBy: approver,
    items: [{ name: "Form 4", serialNumber }],
  });
  const id = batch.items[0].id;
  const resolved = await updatePendingTool(id, { duplicateResolution: "add_unit" });
  expect(resolved.ok).toBe(true);
  expect(await markReadyAsUnit([id], { requestedBy: approver })).toEqual([id]);
  return id;
}

async function events(subjectId: string) {
  return db.select().from(auditEvents).where(eq(auditEvents.subjectId, subjectId));
}

describe("approveAndRecord", () => {
  it("publishes, records pending.approved and tool.published, and busts the catalogue", async () => {
    const id = await researchedItem();

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields() }
    );

    expect(result).toMatchObject({ ok: true, published: true, slug: "bambu-lab-p1s" });
    if (!result.ok) throw new Error("unreachable");
    expect(result).not.toHaveProperty("warning");

    const [pending] = await events(id);
    expect(pending).toMatchObject({
      action: "pending.approved",
      subjectType: "pending_tool",
      actorUserId: approver,
      detail: {
        toolId: result.toolId,
        published: true,
        asUnit: false,
        overridden: false,
        note: null,
      },
    });
    expect((pending.detail as { unitId: string | null }).unitId).toEqual(expect.any(String));

    const [published] = await events(result.toolId);
    expect(published).toMatchObject({
      action: "tool.published",
      subjectType: "tool",
      actorUserId: approver,
    });

    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
  });

  it("approves as a draft with only pending.approved, and still busts the catalogue", async () => {
    const id = await researchedItem();

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: false, fields: fields() }
    );

    expect(result).toMatchObject({ ok: true, published: false });
    if (!result.ok) throw new Error("unreachable");

    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool.published).toBe(false);
    expect((await events(id)).map((event) => event.action)).toEqual(["pending.approved"]);
    expect(await events(result.toolId)).toEqual([]);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
  });

  it("records the override and its note at low confidence", async () => {
    const id = await researchedItem(research(LOW));

    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: false, fields: fields(), overrideNote: "  Read the plate myself.  " }
    );

    expect(result.ok).toBe(true);
    const [event] = await events(id);
    expect(event.detail).toMatchObject({ overridden: true, note: "Read the plate myself." });
  });

  it("records nothing and busts nothing when approval is refused", async () => {
    const id = await researchedItem(research(LOW));

    expect(
      await approveAndRecord({ userId: approver }, { id, publish: true, fields: fields() })
    ).toEqual({ ok: false, error: "low_confidence" });

    expect(await events(id)).toEqual([]);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect((await getPendingTool(id))?.status).toBe("researched");
  });

  it("keeps the tool and warns when the audit trail cannot be written", async () => {
    const id = await researchedItem();
    audit.failing = true;

    // **Never `{ ok: false }` for a tool that exists.** The page would offer
    // Approve again, and a second press would make a second tool (§4.11).
    const result = await approveAndRecord(
      { userId: approver },
      { id, publish: true, fields: fields() }
    );

    expect(result).toMatchObject({ ok: true, warning: "audit_unavailable" });
    if (!result.ok) throw new Error("unreachable");
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool.published).toBe(true);
    expect((await getPendingTool(id))?.status).toBe("approved");
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
  });
});

describe("approveAndRecord — the product image", () => {
  // The image paths themselves are `approval-image.test.ts`; this pins how an
  // approval that chose no image reads, and that the choice is checked only
  // after the refusals that need nothing but the row.
  it("records that no image was chosen, and answers imageAttached: false with no warning", async () => {
    const id = await researchedItem();

    const result = await approveAndRecord({ userId: approver }, { id, publish: true, fields: fields() });

    expect(result).toMatchObject({ ok: true, imageAttached: false });
    expect(result).not.toHaveProperty("warning");
    const [event] = await events(id);
    expect(event.detail).toMatchObject({ image: { choice: "none", attached: false } });
  });

  it("answers the row's own refusal before it looks at an image choice", async () => {
    const missing = crypto.randomUUID();
    expect(
      await approveAndRecord(
        { userId: approver },
        { id: missing, publish: true, fields: fields({ image: { choice: "cleaned" } }) }
      )
    ).toEqual({ ok: false, error: "not_found" });

    const low = await researchedItem(research(LOW));
    expect(
      await approveAndRecord(
        { userId: approver },
        { id: low, publish: true, fields: fields({ image: { choice: "cleaned" } }) }
      )
    ).toEqual({ ok: false, error: "low_confidence" });

    const approved = await researchedItem();
    await approveAndRecord({ userId: approver }, { id: approved, publish: false, fields: fields() });
    expect(
      await approveAndRecord(
        { userId: approver },
        { id: approved, publish: false, fields: fields({ image: { choice: "cleaned" } }) }
      )
    ).toEqual({ ok: false, error: "not_editable" });
  });

  it("refuses a cleaned choice research never produced as invalid_field, and creates nothing", async () => {
    const id = await researchedItem();

    expect(
      await approveAndRecord(
        { userId: approver },
        { id, publish: true, fields: fields({ image: { choice: "cleaned" } }) }
      )
    ).toEqual({ ok: false, error: "invalid_field" });
    expect((await getPendingTool(id))?.status).toBe("researched");
    expect(await events(id)).toEqual([]);
  });
});

describe("addUnitAndRecord", () => {
  it("adds the unit, records pending.approved as a unit, and busts the catalogue", async () => {
    const id = await unitItem("F4-NEW-1");

    const result = await addUnitAndRecord({ userId: approver }, { id, serialNumber: "F4-NEW-1" });

    expect(result).toMatchObject({ ok: true, slug: "form-4", published: true });
    if (!result.ok) throw new Error("unreachable");
    const created = await db.select().from(units).where(eq(units.serialNumber, "F4-NEW-1"));
    expect(created).toHaveLength(1);
    expect(created[0].toolId).toBe(result.toolId);

    const [event] = await events(id);
    expect(event).toMatchObject({
      action: "pending.approved",
      detail: { toolId: result.toolId, unitId: created[0].id, asUnit: true, published: true },
    });
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
  });

  it("reads nothing after the commit, so a database that drops out then cannot turn a created unit into a failure", async () => {
    const id = await unitItem("F4-AFTER-1");
    // Every statement outside the approval's own transaction throws, as a
    // connection lost right after the commit would.
    const dropsOut = Object.create(db) as Db;
    dropsOut.select = (() => {
      throw new Error("connection terminated unexpectedly");
    }) as unknown as Db["select"];

    const result = await addUnitAndRecord({ userId: approver }, { id }, { db: dropsOut });

    expect(result).toMatchObject({ ok: true, slug: "form-4", published: true });
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
  });

  it("passes duplicate_serial through, and records nothing", async () => {
    const first = await unitItem("F4-SAME");
    const second = await unitItem("F4-SAME");
    expect((await addUnitAndRecord({ userId: approver }, { id: first })).ok).toBe(true);
    vi.mocked(revalidateTag).mockClear();

    expect(await addUnitAndRecord({ userId: approver }, { id: second })).toEqual({
      ok: false,
      error: "duplicate_serial",
    });
    expect(await events(second)).toEqual([]);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
  });
});

describe("the Notion mirror (§3.8 trigger 1)", () => {
  it("asks for a push once an approval has committed, published or draft", async () => {
    const published = await researchedItem();
    expect((await approveAndRecord({ userId: approver }, { id: published, publish: true, fields: fields() })).ok).toBe(true);
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(1);

    const draft = await researchedItem();
    expect(
      (await approveAndRecord({ userId: approver }, { id: draft, publish: false, fields: fields({ serialNumber: "P1S-002" }) })).ok
    ).toBe(true);
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(2);
  });

  it("asks for a push when a unit is added", async () => {
    const id = await unitItem("F4-MIRROR-1");
    expect((await addUnitAndRecord({ userId: approver }, { id })).ok).toBe(true);
    expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(1);
  });

  it("passes the caller's database handle through", async () => {
    const id = await unitItem("F4-MIRROR-2");
    await addUnitAndRecord({ userId: approver }, { id }, { db });
    expect(mirror.requestMirrorPush).toHaveBeenCalledWith({ db });
  });

  it("asks for nothing when the approval is refused", async () => {
    const low = await researchedItem(research(LOW));
    expect((await approveAndRecord({ userId: approver }, { id: low, publish: true, fields: fields() })).ok).toBe(false);

    const first = await unitItem("F4-MIRROR-SAME");
    const second = await unitItem("F4-MIRROR-SAME");
    expect((await addUnitAndRecord({ userId: approver }, { id: first })).ok).toBe(true);
    mirror.requestMirrorPush.mockClear();
    expect((await addUnitAndRecord({ userId: approver }, { id: second })).ok).toBe(false);

    expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
  });
});

describe("the manual archive", () => {
  it("starts an archive run for the resources the approval created, after the commit", async () => {
    const id = await researchedItem();
    const result = await approveAndRecord({ userId: approver }, { id, publish: true, fields: fields() });
    if (!result.ok) throw new Error("approval refused");

    const created = await db.select({ id: resources.id }).from(resources).where(eq(resources.toolId, result.toolId));
    expect(created).toHaveLength(1);
    expect(manuals.startManualArchive).toHaveBeenCalledTimes(1);
    expect(manuals.startManualArchive).toHaveBeenCalledWith([created[0].id]);
  });

  it("still approves when the run cannot be started, with no warning and nothing rolled back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    manuals.startManualArchive.mockRejectedValue(new Error("workflow runtime unavailable"));
    const id = await researchedItem();

    const result = await approveAndRecord({ userId: approver }, { id, publish: true, fields: fields() });

    expect(result).toMatchObject({ ok: true, published: true });
    expect(result).not.toHaveProperty("warning");
    if (!result.ok) throw new Error("unreachable");
    expect(await db.select().from(tools).where(eq(tools.id, result.toolId))).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("[manuals]"));
  });

  it("starts nothing when the approval is refused, or when it created no resources", async () => {
    const low = await researchedItem(research(LOW));
    expect((await approveAndRecord({ userId: approver }, { id: low, publish: true, fields: fields() })).ok).toBe(false);

    const bare = await researchedItem(research({ resources: [] }));
    expect((await approveAndRecord({ userId: approver }, { id: bare, publish: true, fields: fields() })).ok).toBe(true);

    expect(manuals.startManualArchive).not.toHaveBeenCalled();
  });
});
