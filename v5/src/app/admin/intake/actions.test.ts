// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission — see `admin/corrections/actions.test.ts`. */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

/** `start()` for Find a different image — the workflow tier has its own tests. */
const wf = vi.hoisted(() => ({ start: vi.fn(), findDifferentImage: vi.fn() }));
vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../../workflows/image-retry", () => ({ findDifferentImage: wf.findDifferentImage }));

/** The audit insert failing on its own, after the approval committed. */
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../../../lib/data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (event: Parameters<typeof actual.recordAuditEvent>[0]) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event);
    },
  };
});

import { count, eq } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { signInAsNew } from "../../../../test/utils/session";
import { resetAuthForTests } from "../../../lib/auth/config";
import {
  completeResearch,
  createPendingBatch,
  getPendingTool,
  markReadyAsUnit,
  markResearching,
  queueForResearch,
  updatePendingTool,
  type ApprovalFields,
} from "../../../lib/data/pending-tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, tools, units } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import type { ResearchResult } from "../../../lib/research/result";
import { CATALOG_TAG } from "../../../lib/revalidate";
import {
  addPendingUnit,
  approvePending,
  approvePendingAsDraft,
  discardPending,
  requestDifferentImage,
  savePendingIdentity,
} from "./actions";

/**
 * The review queue's endpoints (spec §5.4 steps 11–12, §8, §4.11, Article 5).
 *
 * Called directly, with no page: a server action is a POST endpoint with a
 * generated name, and these are the ones that turn research into catalogue.
 * "Research creates a tool nobody approved" is on §10's list of things that
 * would embarrass us, so most of what is asserted here is what does *not*
 * happen — to an anonymous caller, to somebody holding only the adjacent
 * permission, to a low-confidence item with no note, to an item approved twice.
 */

const AUTH_SECRET = "admin-intake-test-secret";

let db: Db;
let adminId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  audit.failing = false;
  wf.start.mockReset();
  wf.start.mockResolvedValue({ runId: "wrun_image" });
  vi.mocked(revalidateTag).mockClear();
  vi.mocked(revalidatePath).mockClear();

  db = await getDb();
  const signedIn = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  adminId = signedIn.user.id;
  setMockHeaders({ cookie: signedIn.cookie });
});

afterEach(() => {
  override.permissions = null;
  audit.failing = false;
  resetAuthForTests();
  resetDbForTests();
});

function research(overrides: Partial<ResearchResult> = {}): ResearchResult {
  return {
    canonicalName: "Bambu Lab P1S",
    description: "An enclosed FDM printer.",
    specs: [{ label: "Build volume", value: "256 mm cube" }],
    materials: ["PLA", "PETG"],
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
    materials: ["PLA", "PETG"],
    ppeRequired: [],
    tags: ["3d-printing"],
    trainingRequired: true,
    useRestrictions: null,
    serialNumber: "P1S-001",
    resourceUrls: ["https://example.com/p1s.pdf"],
    ...overrides,
  };
}

/** An item taken the whole way through research, the way the workflow does. */
async function researchedItem(result: ResearchResult = research()): Promise<string> {
  const batch = await createPendingBatch({
    createdBy: adminId,
    items: [{ name: "Bambu Lab P1S" }],
  });
  const id = batch.items[0].id;
  await queueForResearch([id], { requestedBy: adminId });
  await markResearching(id);
  await completeResearch(id, result);
  return id;
}

/** An item that matched the seeded Form 4 and was resolved as another unit. */
async function unitItem(serialNumber: string | null = null): Promise<string> {
  const batch = await createPendingBatch({
    createdBy: adminId,
    items: [{ name: "Form 4", serialNumber }],
  });
  const id = batch.items[0].id;
  await updatePendingTool(id, { duplicateResolution: "add_unit" });
  await markReadyAsUnit([id], { requestedBy: adminId });
  return id;
}

async function toolCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(tools);
  return Number(row.n);
}

async function actionsFor(subjectId: string): Promise<string[]> {
  const rows = await db.select().from(auditEvents).where(eq(auditEvents.subjectId, subjectId));
  return rows.map((row) => row.action);
}

describe("who may call these", () => {
  it("refuses an anonymous caller everywhere, and nothing changes", async () => {
    const id = await researchedItem();
    setMockHeaders();

    const refusal = { ok: false, error: "not_signed_in" };
    expect(await approvePending({ id, fields: fields() })).toEqual(refusal);
    expect(await approvePendingAsDraft({ id, fields: fields() })).toEqual(refusal);
    expect(await addPendingUnit({ id, serialNumber: null })).toEqual(refusal);
    expect(await discardPending({ id })).toEqual(refusal);
    expect(await savePendingIdentity({ id, name: "X", brand: null })).toEqual(refusal);

    expect((await getPendingTool(id))?.status).toBe("researched");
  });

  it("refuses a student", async () => {
    const id = await researchedItem();
    const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
    setMockHeaders({ cookie: student.cookie });

    expect(await approvePendingAsDraft({ id, fields: fields() })).toEqual({
      ok: false,
      error: "not_permitted",
    });
  });

  it("checks tools.approve, not the neighbouring tool permissions", async () => {
    const id = await researchedItem();

    // Every tool permission but the one this surface is gated on.
    override.permissions = new Set(["tools.add", "tools.edit", "tools.publish"]);
    const refused = { ok: false, error: "not_permitted" };
    expect(await approvePending({ id, fields: fields() })).toEqual(refused);
    expect(await approvePendingAsDraft({ id, fields: fields() })).toEqual(refused);
    expect(await addPendingUnit({ id, serialNumber: null })).toEqual(refused);
    expect(await discardPending({ id })).toEqual(refused);
    expect(await savePendingIdentity({ id, name: "Bambu P1S", brand: null })).toEqual(refused);
    expect(await toolCount()).toBe(2);
  });

  it("refuses Approve without tools.publish, while Approve as draft goes through", async () => {
    const id = await researchedItem();
    override.permissions = new Set(["tools.approve"]);

    expect(await approvePending({ id, fields: fields() })).toEqual({
      ok: false,
      error: "not_permitted",
    });
    expect((await getPendingTool(id))?.status).toBe("researched");

    expect(await approvePendingAsDraft({ id, fields: fields() })).toMatchObject({
      ok: true,
      published: false,
    });
  });

  it("parses its input, and a shape that does not parse reaches nothing", async () => {
    const id = await researchedItem();

    expect(await approvePending({ id: "not-a-uuid", fields: fields() })).toEqual({
      ok: false,
      error: "invalid_field",
    });
    expect(await approvePending({ id, fields: fields({ name: "   " }) })).toEqual({
      ok: false,
      error: "invalid_field",
    });
    expect(await approvePending({ id, fields: { ...fields(), published: true } })).toEqual({
      ok: false,
      error: "invalid_field",
    });
    expect(await approvePending({ id, fields: fields(), overrideNote: "x".repeat(1001) })).toEqual({
      ok: false,
      error: "invalid_field",
    });
    expect(await toolCount()).toBe(2);
  });
});

describe("approvePending and approvePendingAsDraft", () => {
  it("publishes, records pending.approved and tool.published, and busts the catalogue", async () => {
    const id = await researchedItem();

    const result = await approvePending({ id, fields: fields() });

    expect(result).toMatchObject({ ok: true, published: true, slug: "bambu-lab-p1s" });
    if (!result.ok) throw new Error("unreachable");
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool.published).toBe(true);

    expect(await actionsFor(id)).toEqual(["pending.approved"]);
    expect(await actionsFor(result.toolId)).toEqual(["tool.published"]);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/intake");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/admin/intake/${id}`);
  });

  it("approves as a draft: only pending.approved, and the tool stays unpublished", async () => {
    const id = await researchedItem();

    const result = await approvePendingAsDraft({ id, fields: fields() });

    expect(result).toMatchObject({ ok: true, published: false });
    if (!result.ok) throw new Error("unreachable");
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool.published).toBe(false);
    expect(await actionsFor(id)).toEqual(["pending.approved"]);
    expect(await actionsFor(result.toolId)).toEqual([]);
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(CATALOG_TAG, { expire: 0 });
  });

  it("refuses a low-confidence item with no note, and creates nothing", async () => {
    const id = await researchedItem(research(LOW));

    expect(await approvePending({ id, fields: fields() })).toEqual({
      ok: false,
      error: "low_confidence",
    });
    expect(await approvePendingAsDraft({ id, fields: fields(), overrideNote: "   " })).toEqual({
      ok: false,
      error: "low_confidence",
    });

    expect(await toolCount()).toBe(2);
    expect(await actionsFor(id)).toEqual([]);
    expect(vi.mocked(revalidateTag)).not.toHaveBeenCalled();
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("approves a low-confidence item with a note, and stores the note", async () => {
    const id = await researchedItem(research(LOW));

    const result = await approvePendingAsDraft({
      id,
      fields: fields(),
      overrideNote: "Read the model plate myself.",
    });

    expect(result.ok).toBe(true);
    const item = await getPendingTool(id);
    expect(item?.status).toBe("approved");
    expect(item?.approvalNote).toBe("Read the model plate myself.");
    expect(item?.approvedBy).toBe(adminId);
  });

  it("answers not_editable to a second approval, and there is still one tool", async () => {
    const id = await researchedItem();

    expect((await approvePending({ id, fields: fields() })).ok).toBe(true);
    expect(await approvePendingAsDraft({ id, fields: fields() })).toEqual({
      ok: false,
      error: "not_editable",
    });
    expect(await toolCount()).toBe(3);
  });

  it("keeps the tool and warns when the audit trail cannot be written", async () => {
    const id = await researchedItem();
    audit.failing = true;

    const result = await approvePending({ id, fields: fields() });

    expect(result).toMatchObject({ ok: true, published: true, warning: "audit_unavailable" });
    if (!result.ok) throw new Error("unreachable");
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.toolId));
    expect(tool).toBeDefined();
    expect(await db.select().from(auditEvents)).toEqual([]);
  });
});

describe("the product image choice", () => {
  const IMAGE_URL = "https://images.example.com/p1s.png";

  function withImages(): ResearchResult {
    return research({
      images: {
        candidates: [
          {
            url: IMAGE_URL,
            pageUrl: "https://example.com/p1s",
            source: "og",
            width: 1200,
            height: 900,
            contentType: "image/png",
            rank: 1,
            reason: "Front on.",
          },
        ],
        cleaned: { attachmentId: crypto.randomUUID(), fromUrl: IMAGE_URL },
      },
    });
  }

  it("parses the choice strictly, and a shape that does not parse reaches nothing", async () => {
    const id = await researchedItem(withImages());

    for (const image of [
      { choice: "cleaned", candidateUrl: IMAGE_URL },
      { choice: "original" },
      { choice: "original", candidateUrl: "" },
      { choice: "original", candidateUrl: `https://example.com/${"x".repeat(2048)}` },
      { choice: "stock photo" },
      "cleaned",
    ]) {
      expect(await approvePending({ id, fields: { ...fields(), image } })).toEqual({
        ok: false,
        error: "invalid_field",
      });
    }
    expect(await toolCount()).toBe(2);
  });

  it("refuses an original research never recorded, before anything is downloaded", async () => {
    const id = await researchedItem(withImages());

    expect(
      await approvePending({
        id,
        fields: { ...fields(), image: { choice: "original", candidateUrl: "http://169.254.169.254/" } },
      })
    ).toEqual({ ok: false, error: "invalid_field" });
    expect(await toolCount()).toBe(2);
  });

  it("approves without the image and says so when it cannot be attached (no Blob store here)", async () => {
    const id = await researchedItem(withImages());

    const result = await approvePending({ id, fields: { ...fields(), image: { choice: "cleaned" } } });

    expect(result).toMatchObject({ ok: true, published: true, warning: "image_not_attached", imageAttached: false });
    expect(await toolCount()).toBe(3);
    const [event] = await db.select().from(auditEvents).where(eq(auditEvents.subjectId, id));
    expect(event.detail).toMatchObject({ image: { choice: "cleaned", attached: false } });
  });

  it("takes an explicit none like no choice at all", async () => {
    const id = await researchedItem(withImages());

    const result = await approvePendingAsDraft({ id, fields: { ...fields(), image: { choice: "none" } } });

    expect(result).toMatchObject({ ok: true, published: false, imageAttached: false });
    expect(result).not.toHaveProperty("warning");
  });
});

describe("addPendingUnit", () => {
  it("adds the unit to the tool it matched", async () => {
    const id = await unitItem("F4-NEW-1");

    const result = await addPendingUnit({ id, serialNumber: "F4-NEW-1" });

    expect(result).toMatchObject({ ok: true, slug: "form-4" });
    const [unit] = await db.select().from(units).where(eq(units.serialNumber, "F4-NEW-1"));
    expect(unit).toBeDefined();
    expect((await getPendingTool(id))?.createdUnitId).toBe(unit.id);
    expect(await actionsFor(id)).toEqual(["pending.approved"]);
  });

  it("answers duplicate_serial for a serial the tool already has", async () => {
    const first = await unitItem();
    const second = await unitItem();

    expect((await addPendingUnit({ id: first, serialNumber: "F4-SAME" })).ok).toBe(true);
    expect(await addPendingUnit({ id: second, serialNumber: "F4-SAME" })).toEqual({
      ok: false,
      error: "duplicate_serial",
    });
    expect((await getPendingTool(second))?.status).toBe("researched");
  });

  it("answers not_editable for an item that was never an add-unit item", async () => {
    const id = await researchedItem();
    expect(await addPendingUnit({ id, serialNumber: null })).toEqual({
      ok: false,
      error: "not_editable",
    });
  });
});

describe("discardPending and savePendingIdentity", () => {
  it("discards, and refreshes the queue and the item's page", async () => {
    const id = await researchedItem();

    expect(await discardPending({ id })).toEqual({ ok: true });

    expect((await getPendingTool(id))?.status).toBe("discarded");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/intake");
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/admin/intake/${id}`);
    // Discarding creates nothing and publishes nothing, so it is not audited.
    expect(await actionsFor(id)).toEqual([]);
  });

  it("answers not_found for an item that does not exist", async () => {
    expect(await discardPending({ id: crypto.randomUUID() })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("saves a corrected name and brand, re-running the duplicate check", async () => {
    const id = await researchedItem();

    expect(await savePendingIdentity({ id, name: "  Form 4  ", brand: "" })).toEqual({ ok: true });

    const item = await getPendingTool(id);
    expect(item?.name).toBe("Form 4");
    expect(item?.brand).toBeNull();
    // Renamed onto a seeded tool: the check now finds it.
    expect(item?.duplicateOf).toMatchObject({ kind: "tool", slug: "form-4" });
  });
});

describe('Find a different image (amendment "Product-page first, front-facing images, reviewer notes")', () => {
  const images = {
    candidates: [
      {
        url: "https://example.com/p1s-back.jpg",
        pageUrl: "https://example.com/p1s",
        source: "og" as const,
        width: 1200,
        height: 900,
        contentType: "image/jpeg" as const,
        rank: 1 as const,
        reason: "back",
        view: "back" as const,
      },
    ],
    cleaned: null,
  };

  it("refuses an anonymous caller and one holding only the adjacent permission, and starts nothing", async () => {
    const id = await researchedItem(research({ images }));
    setMockHeaders();
    expect(await requestDifferentImage({ id, note: null })).toEqual({ ok: false, error: "not_signed_in" });

    const signedIn = await signInAsNew({ email: "maker@cornell.edu", role: "admin" });
    setMockHeaders({ cookie: signedIn.cookie });
    override.permissions = new Set(["tools.add", "tools.edit", "tools.publish"]);
    expect(await requestDifferentImage({ id, note: null })).toEqual({ ok: false, error: "not_permitted" });
    expect(wf.start).not.toHaveBeenCalled();
    expect((await getPendingTool(id))?.research?.imageRetry).toBeUndefined();
  });

  it("marks the run, charges the allowance and starts the workflow with the cleaned note", async () => {
    const id = await researchedItem(research({ images }));
    expect(await requestDifferentImage({ id, note: "  a front-facing photo\nof the whole printer " })).toEqual({ ok: true });

    const retry = (await getPendingTool(id))?.research?.imageRetry;
    expect(retry).toMatchObject({ status: "running", note: "a front-facing photo of the whole printer", error: null });
    expect(wf.start).toHaveBeenCalledWith(wf.findDifferentImage, [retry!.requestId, id, "a front-facing photo of the whole printer"]);
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith(`/admin/intake/${id}`);

    // A second press while it runs is refused, and starts nothing more.
    expect(await requestDifferentImage({ id, note: null })).toEqual({ ok: false, error: "image_retry_running" });
    expect(wf.start).toHaveBeenCalledTimes(1);
  });

  it("refuses a note over the cap without starting anything", async () => {
    const id = await researchedItem(research({ images }));
    expect(await requestDifferentImage({ id, note: "x".repeat(301) })).toEqual({ ok: false, error: "invalid_field" });
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("says start_failed, and marks the run failed, when the workflow will not start", async () => {
    const id = await researchedItem(research({ images }));
    wf.start.mockRejectedValueOnce(new Error("world unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await requestDifferentImage({ id, note: null })).toEqual({ ok: false, error: "start_failed" });
    expect((await getPendingTool(id))?.research?.imageRetry?.status).toBe("failed");
  });

  it("counts against the daily research limit", async () => {
    const id = await researchedItem(research({ images }));
    const { RESEARCH_DAILY_ITEM_LIMIT } = await import("../../../lib/intake/limits");
    const { researchRequests } = await import("../../../lib/db/schema/index");
    await db.insert(researchRequests).values(
      Array.from({ length: RESEARCH_DAILY_ITEM_LIMIT }, () => ({ requestId: crypto.randomUUID(), userId: adminId, pendingToolId: null }))
    );
    expect(await requestDifferentImage({ id, note: null })).toEqual({ ok: false, error: "daily_limit" });
    expect(wf.start).not.toHaveBeenCalled();
  });
});

