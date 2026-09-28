// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold one permission — see `admin/intake/actions.test.ts`. */
const override = vi.hoisted(() => ({ without: null as string | null }));
vi.mock("../auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      permission === override.without ? false : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

/** Research's workflow start — the workflow tier has its own tests. */
const wf = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../workflows/research-batch", () => ({ researchBatch: vi.fn() }));
/** Today's research limit, when a test sets one; the real rule otherwise. */
const limit = vi.hoisted(() => ({ value: null as number | null }));
vi.mock("../data/research-allowances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/research-allowances")>();
  return { ...actual, researchLimitFor: async (...args: Parameters<typeof actual.researchLimitFor>) => limit.value ?? actual.researchLimitFor(...args) };
});
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../manuals/trigger", () => ({ requestManualArchive: vi.fn(async () => undefined) }));

import { approvePendingAsDraft } from "../../app/admin/intake/actions";
import { resetAuthForTests } from "../auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { listAuditEvents } from "../data/audit";
import {
  completeResearch,
  createPendingBatch,
  getPendingTool,
  markResearching,
  queueForResearch,
  updatePendingTool,
  type ApprovalFields,
} from "../data/pending-tools";
import { getDb, resetDbForTests } from "../db/client";
import { attachments, pendingTools, tools } from "../db/schema/index";
import { eq } from "drizzle-orm";
import type { ResearchResult } from "../research/result";
import { signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction } from "./proposals";
import { actionById } from "./registry";

/**
 * Intake from a card (assistant–GUI parity spec §5.2, §9 phase 5): "approve
 * these" proposes one card with a row per selected item, each the approval
 * the review page would send untouched; approving with publish is refused
 * without `tools.publish`; a low-confidence item is refused on its own row;
 * the research allowance is enforced at the click exactly as by the button.
 */

let adminId: string;
let identity: Identity;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "intake-actions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.without = null;
  limit.value = null;
  wf.start.mockReset();
  wf.start.mockResolvedValue({ runId: "wrun_1" });
  const signedIn = await signInAsNew({ email: "niti@cornell.edu", role: "admin", name: "Niti" });
  adminId = signedIn.user.id;
  setMockHeaders({ cookie: signedIn.cookie });
  identity = await resolveIdentityFromHeaders();
});

afterEach(() => {
  override.without = null;
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

async function researchedItem(name: string, result: ResearchResult = research({ canonicalName: name })): Promise<string> {
  const batch = await createPendingBatch({ createdBy: adminId, items: [{ name }] });
  const id = batch.items[0].id;
  await queueForResearch([id], { requestedBy: adminId });
  await markResearching(id);
  await completeResearch(id, result);
  return id;
}

async function identifiedItem(name: string): Promise<string> {
  const batch = await createPendingBatch({ createdBy: adminId, items: [{ name }] });
  return batch.items[0].id;
}

const propose = (actionId: string, args: unknown) =>
  proposeAction(actionById(actionId)!, args, { identity, surface: "assistant", chatId: "chat-1" });

describe("approve these", () => {
  it("proposes one card with a row per item and confirms both as drafts, as the page would", async () => {
    const a = await researchedItem("Zyx Printer One");
    const b = await researchedItem("Qopa Wood Lathe");
    const proposed = await propose("pending.approve", { pending_ids: [a, b], publish: false });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals.map((p) => p.subjectId)).toEqual([a, b]);
    expect(proposed.proposals[0].preview).toMatchObject({ summary: { key: "pending_approve_draft" } });
    // Nothing reached the catalogue by proposing.
    const db = await getDb();
    const before = (await db.select().from(tools)).length;

    const results = await decideActionProposals({ ids: proposed.proposals.map((p) => p.id), decision: "confirm" }, identity);
    expect(results.map((r) => r.status)).toEqual(["confirmed", "confirmed"]);
    const created = (await db.select().from(tools)).filter((t) => ["Zyx Printer One", "Qopa Wood Lathe"].includes(t.name));
    expect((await db.select().from(tools)).length).toBe(before + 2);
    expect(created.map((t) => [t.name, t.published]).sort()).toEqual([
      ["Qopa Wood Lathe", false],
      ["Zyx Printer One", false],
    ]);
    const approved = (await listAuditEvents()).filter((e) => e.action === "pending.approved");
    expect(approved.map((e) => e.surface)).toEqual(["assistant", "assistant"]);
    expect((await getPendingTool(a))?.status).toBe("approved");
  });

  it("stores the same approval the page sends for an untouched item", async () => {
    const card = await researchedItem("Bambu Lab P1S");
    const page = await researchedItem("Bambu Lab P1S Combo", research({ canonicalName: "Bambu Lab P1S Combo" }));
    const proposed = await propose("pending.approve", { pending_ids: [card], publish: false });
    if (!proposed.ok) throw new Error(proposed.error);
    const fields = (proposed.proposals[0].input as { fields: ApprovalFields }).fields;
    expect(fields).toMatchObject({
      description: "An enclosed FDM printer.",
      newCategory: { name: "FDM", group: "3D Printing" },
      materials: ["PLA", "PETG"],
      trainingRequired: true,
      resourceUrls: ["https://example.com/p1s.pdf"],
      image: { choice: "none" },
    });
    // And the page's own button takes that shape unchanged.
    expect(await approvePendingAsDraft({ id: page, fields: { ...fields, name: "Bambu Lab P1S Combo" }, overrideNote: null })).toMatchObject({
      ok: true,
      published: false,
    });
  });

  it("sends research's image over a photo from the chat, and the photo — background removed — only when research found none", async () => {
    // Amendment "An uploaded photo is a choice, not the product image": the card
    // sends what the page preselects, and the page never lets the photo displace a found image.
    const db = await getDb();
    async function withPhoto(name: string, images: ResearchResult["images"]) {
      const [photo] = await db
        .insert(attachments)
        .values({ blobPathname: `uploads/chat/${crypto.randomUUID()}.jpg`, access: "public", contentType: "image/jpeg", origin: "upload", uploadedBy: adminId })
        .returning({ id: attachments.id });
      const batch = await createPendingBatch({ createdBy: adminId, items: [{ name, attachmentIds: [photo.id] }] });
      const id = batch.items[0].id;
      await queueForResearch([id], { requestedBy: adminId });
      await markResearching(id);
      await completeResearch(id, research({ canonicalName: name, images }));
      return { id, photoId: photo.id };
    }
    const found = await withPhoto("Zorblax Photo Rig", {
      candidates: [
        { url: "https://example.com/p1s.png", pageUrl: "https://example.com/p1s", source: "og", width: 1200, height: 900, contentType: "image/png", rank: 1, reason: "The printer." },
      ],
      cleaned: null,
    });
    const nothing = await withPhoto("Quimby Wood Jig", { candidates: [], cleaned: null });

    const proposed = await propose("pending.approve", { pending_ids: [found.id, nothing.id], publish: false });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.refused).toEqual([]);
    const images = proposed.proposals.map((p) => (p.input as { fields: ApprovalFields }).fields.image);
    expect(images).toEqual([
      { choice: "original", candidateUrl: "https://example.com/p1s.png" },
      { choice: "upload", attachmentId: nothing.photoId, removeBackground: true },
    ]);
  });

  it("refuses publish for somebody without tools.publish, on every row", async () => {
    override.without = "tools.publish";
    const a = await researchedItem("Bambu Lab P1S");
    expect(await propose("pending.approve", { pending_ids: [a], publish: true })).toMatchObject({ ok: false, error: "not_permitted" });
    // A draft is still theirs to approve.
    expect(await propose("pending.approve", { pending_ids: [a], publish: false })).toMatchObject({ ok: true });
  });

  it("refuses a low-confidence item on its own row and proposes the rest", async () => {
    const low = await researchedItem("Mystery box", research({ confidence: { level: "low", basis: [], unknowns: [] } }));
    const ok = await researchedItem("Prusa MK4");
    const notYet = await identifiedItem("Unresearched thing");
    const proposed = await propose("pending.approve", { pending_ids: [low, ok, notYet], publish: false });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals.map((p) => p.subjectId)).toEqual([ok]);
    expect(proposed.refused).toEqual([
      { subjectId: low, error: "low_confidence" },
      { subjectId: notYet, error: "not_editable" },
    ]);
  });
});

describe("an approval card goes stale with its item", () => {
  it("answers conflict, and creates nothing, when the item was renamed after the card was drawn", async () => {
    const a = await researchedItem("Zyx Printer One");
    const proposed = await propose("pending.approve", { pending_ids: [a], publish: false });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(await updatePendingTool(a, { name: "Zyx Printer Two" })).toMatchObject({ ok: true });

    const [result] = await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, identity);
    expect(result.status).toBe("conflict");
    const db = await getDb();
    expect((await db.select().from(tools)).filter((t) => t.name.startsWith("Zyx Printer"))).toEqual([]);
    expect((await getPendingTool(a))?.status).toBe("researched");
  });

  it("answers conflict when the research changed after the card was drawn", async () => {
    const a = await researchedItem("Qopa Wood Lathe");
    const proposed = await propose("pending.approve", { pending_ids: [a], publish: false });
    if (!proposed.ok) throw new Error(proposed.error);
    const db = await getDb();
    await db
      .update(pendingTools)
      .set({ research: research({ canonicalName: "Qopa Wood Lathe", description: "A newer description." }) })
      .where(eq(pendingTools.id, a));

    const [result] = await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, identity);
    expect(result.status).toBe("conflict");
    expect((await getPendingTool(a))?.status).toBe("researched");
  });
});

describe("edit_pending_items never discards", () => {
  it("refuses the discard decision, which is discard_pending_item's alone", async () => {
    const a = await identifiedItem("Zyx Printer One");
    const proposed = await propose("pending.edit", { pending_ids: [a], duplicate_resolution: "discard" });
    expect(proposed.ok).toBe(false);
    expect(actionById("pending.edit")!.input.safeParse({ id: a, patch: { duplicateResolution: "discard" } }).success).toBe(false);
    expect((await getPendingTool(a))?.status).toBe("identified");
  });
});

describe("research from a card spends exactly as the button does", () => {
  it("starts research at the click, and the allowance is checked at the click", async () => {
    const a = await identifiedItem("Qrz Cutter 9");
    const b = await identifiedItem("Qrz Sander 7");
    const proposed = await propose("pending.research", { pending_ids: [a, b] });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals).toHaveLength(1);
    expect(proposed.proposals[0].preview).toMatchObject({ summary: { key: "pending_research", values: { count: 2 } } });
    expect(wf.start).not.toHaveBeenCalled();

    // The allowance shrinks before the click: the card is refused, nothing moves.
    limit.value = 1;
    const [outcome] = await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, identity);
    expect(outcome).toMatchObject({ status: "failed", error: "daily_limit" });
    expect(wf.start).not.toHaveBeenCalled();
    expect((await getPendingTool(a))?.status).toBe("identified");
  });

  it("queues the items and starts one run when the allowance holds", async () => {
    const a = await identifiedItem("Qrz Cutter 9");
    const proposed = await propose("pending.research", { pending_ids: [a] });
    if (!proposed.ok) throw new Error(proposed.error);
    const [outcome] = await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, identity);
    expect(outcome).toMatchObject({ status: "confirmed" });
    expect(wf.start).toHaveBeenCalledTimes(1);
    expect((await getPendingTool(a))?.status).toBe("queued");
  });
});

describe("discard is destructive", () => {
  it("needs the item's name typed, and is refused in a turn that read outside content", async () => {
    const a = await identifiedItem("Old drill");
    expect(await proposeAction(actionById("pending.discard")!, { pending_id: a }, { identity, surface: "assistant", chatId: null, tainted: true })).toEqual({
      ok: false,
      error: "tainted_turn",
    });
    const proposed = await propose("pending.discard", { pending_id: a });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm", typed: "old drill" }, identity)).toEqual([
      expect.objectContaining({ status: "confirmed" }),
    ]);
    expect((await getPendingTool(a))?.status).toBe("discarded");
  });
});
