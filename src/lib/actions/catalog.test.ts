// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../manuals/trigger", () => ({ requestManualArchive: vi.fn(async () => undefined) }));

import { eq } from "drizzle-orm";
import { publish, saveTool } from "../../app/admin/inventory/actions";
import { resetAuthForTests } from "../auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { listAuditEvents } from "../data/audit";
import { readToolRevision } from "../data/tools";
import { getDb, resetDbForTests } from "../db/client";
import { actionProposals, auditEvents, maintenanceLogs, resources, session, tools, units, user } from "../db/schema/index";
import { signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction } from "./proposals";
import { actionById } from "./registry";

/**
 * The catalogue actions from a card (assistant–GUI parity spec §9 phase 4):
 * the same publish from the editor and from a card lands the same row and the
 * same `tool.published` event but for `surface` and `proposal_id`; a save in
 * the editor between the card and the click answers `conflict` and writes
 * nothing; archiving and deleting are destructive (the typed name, one at a
 * time); a unit with history is refused before any card is drawn. Real
 * PGlite and sessions; the mirror and the manual archive are stubbed.
 */

let db: Awaited<ReturnType<typeof getDb>>;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "catalog-actions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  db = await getDb();
  await db.delete(actionProposals);
  await db.delete(auditEvents);
  await db.delete(maintenanceLogs);
  await db.delete(resources);
  await db.delete(units);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function staff(): Promise<Identity> {
  const signedIn = await signInAsNew({ email: "sam@cornell.edu", role: "admin", name: "Sam" });
  setMockHeaders({ cookie: signedIn.cookie });
  return resolveIdentityFromHeaders();
}

async function tool(slug: string, name: string, extra: Partial<typeof tools.$inferInsert> = {}) {
  const [row] = await db.insert(tools).values({ slug, name, published: false, ...extra }).returning();
  return row;
}

async function propose(actionId: string, args: unknown, identity: Identity, tainted = false) {
  return proposeAction(actionById(actionId)!, args, { identity, surface: "assistant", chatId: "chat-1", tainted });
}

async function confirm(ids: string[], identity: Identity, typed?: string) {
  return decideActionProposals({ ids, decision: "confirm", ...(typed !== undefined ? { typed } : {}) }, identity);
}

describe("publish from the editor and from a card", () => {
  it("lands the same row and the same event, surface and proposal id apart", async () => {
    const identity = await staff();
    const a = await tool("glowforge", "Glowforge");
    const b = await tool("wen-sander", "WEN sander");

    expect(await publish({ toolId: a.id, expectedRevision: (await readToolRevision(a.id))! })).toMatchObject({ ok: true });
    const proposed = await propose("tools.set_published", { tool_ids: ["wen-sander"], published: true }, identity);
    expect(proposed).toMatchObject({ ok: true });
    if (!proposed.ok) return;
    // Proposing changed nothing.
    expect((await db.select().from(tools).where(eq(tools.id, b.id)))[0].published).toBe(false);
    expect(proposed.proposals[0].preview).toMatchObject({
      summary: { key: "tools_publish", values: { name: "WEN sander" } },
      rows: [{ field: "catalogue", before: "unpublished", after: "published", format: "published" }],
      link: "/tools/wen-sander",
    });

    expect(await confirm([proposed.proposals[0].id], identity)).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect((await db.select().from(tools).where(eq(tools.id, b.id)))[0].published).toBe(true);

    const events = (await listAuditEvents()).filter((e) => e.action === "tool.published");
    expect(events.map((e) => [e.subjectId, e.surface]).sort()).toEqual([[a.id, "gui"], [b.id, "assistant"]].sort());
    expect(events.find((e) => e.subjectId === b.id)).toMatchObject({ proposalId: proposed.proposals[0].id, actorUserId: identity.userId });
  });

  it("answers conflict when the editor saved between the card and the click, and writes nothing", async () => {
    const identity = await staff();
    const t = await tool("form-4", "Form 4", { description: "before" });
    const proposed = await propose("tools.set_published", { tool_ids: [t.id], published: true }, identity);
    if (!proposed.ok) throw new Error(proposed.error);

    expect(await saveTool({ toolId: t.id, expectedRevision: (await readToolRevision(t.id))!, patch: { description: "after" } })).toMatchObject({
      ok: true,
    });
    const [outcome] = await confirm([proposed.proposals[0].id], identity);
    expect(outcome).toMatchObject({ status: "conflict", error: "conflict" });
    expect((await db.select().from(tools).where(eq(tools.id, t.id)))[0].published).toBe(false);
    expect((await listAuditEvents()).filter((e) => e.action === "tool.published")).toEqual([]);
  });

  it("marks several tools reviewed from one card, a row each", async () => {
    const identity = await staff();
    const a = await tool("a-tool", "A tool");
    const b = await tool("b-tool", "B tool");
    const proposed = await propose("tools.mark_reviewed", { tool_ids: [a.id, b.id] }, identity);
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals).toHaveLength(2);
    expect((await confirm(proposed.proposals.map((p) => p.id), identity)).map((o) => o.status)).toEqual(["confirmed", "confirmed"]);
    const rows = await db.select().from(tools);
    expect(rows.every((row) => row.lastReviewedAt !== null && row.lastReviewedBy === identity.userId)).toBe(true);
  });
});

describe("destructive catalogue actions", () => {
  it("archives only with the tool's name typed, and never from a turn that read outside content", async () => {
    const identity = await staff();
    const t = await tool("glowforge", "Glowforge Pro");

    expect(await propose("tools.archive", { tool_id: t.id }, identity, true)).toEqual({ ok: false, error: "tainted_turn" });

    const proposed = await propose("tools.archive", { tool_id: t.id }, identity);
    if (!proposed.ok) throw new Error(proposed.error);
    expect(await confirm([proposed.proposals[0].id], identity)).toEqual([
      expect.objectContaining({ status: "failed", error: "confirmation_mismatch" }),
    ]);
    expect((await db.select().from(tools).where(eq(tools.id, t.id)))[0].archivedAt).toBeNull();

    expect(await confirm([proposed.proposals[0].id], identity, "  glowforge PRO ")).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect((await db.select().from(tools).where(eq(tools.id, t.id)))[0].archivedAt).not.toBeNull();
    expect((await listAuditEvents()).find((e) => e.action === "tool.archived")).toMatchObject({ surface: "assistant", detail: { archived: true } });
  });

  it("refuses to propose deleting a unit that has maintenance history", async () => {
    const identity = await staff();
    const t = await tool("prusa", "Prusa");
    const [unit] = await db.insert(units).values({ toolId: t.id, unitLabel: "Prusa #1" }).returning();
    await db.insert(maintenanceLogs).values({ title: "Clogged", unitId: unit.id, status: "resolved" });
    expect(await propose("units.delete", { tool_id: t.id, unit_id: unit.id }, identity)).toMatchObject({
      ok: false,
      error: "unit_has_history",
    });
  });

  it("removes a resource with its title typed", async () => {
    const identity = await staff();
    const t = await tool("prusa", "Prusa");
    const [res] = await db.insert(resources).values({ toolId: t.id, title: "Prusa SOP", url: "https://example.com/sop" }).returning();
    const proposed = await propose("resources.remove", { tool_id: t.id, resource_id: res.id }, identity);
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals[0].preview).toMatchObject({ subjectName: "Prusa SOP" });
    expect(await confirm([proposed.proposals[0].id], identity, "prusa sop")).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect(await db.select().from(resources).where(eq(resources.id, res.id))).toEqual([]);
  });
});

describe("units and resources from a card", () => {
  it("adds a unit and a link, each moving the tool's revision like the panel", async () => {
    const identity = await staff();
    const t = await tool("prusa", "Prusa");
    const before = await readToolRevision(t.id);

    const unit = await propose("units.add", { tool_id: "prusa", label: "Prusa #3", serial_number: "SN-3", status: "available" }, identity);
    if (!unit.ok) throw new Error(unit.error);
    expect(unit.proposals[0].preview.rows).toEqual(
      expect.arrayContaining([
        { field: "unitLabel", before: null, after: "Prusa #3" },
        { field: "unitStatus", before: null, after: "available", format: "unitStatus" },
      ])
    );
    expect(await confirm([unit.proposals[0].id], identity)).toEqual([expect.objectContaining({ status: "confirmed" })]);

    const link = await propose("resources.add", { tool_id: t.id, title: "Manual", url: "https://example.com/manual.pdf", type: "Manual" }, identity);
    if (!link.ok) throw new Error(link.error);
    expect(await confirm([link.proposals[0].id], identity)).toEqual([expect.objectContaining({ status: "confirmed" })]);

    expect((await db.select().from(units).where(eq(units.toolId, t.id))).map((u) => [u.unitLabel, u.serialNumber])).toEqual([["Prusa #3", "SN-3"]]);
    expect((await db.select().from(resources).where(eq(resources.toolId, t.id))).map((r) => [r.title, r.published])).toEqual([["Manual", true]]);
    expect(await readToolRevision(t.id)).not.toBe(before);
  });

  it("offers nothing to change for an edit with no field", async () => {
    const identity = await staff();
    const t = await tool("prusa", "Prusa");
    const [unit] = await db.insert(units).values({ toolId: t.id, unitLabel: "Prusa #1" }).returning();
    expect(await propose("units.edit", { tool_id: t.id, unit_id: unit.id }, identity)).toEqual({ ok: false, error: "nothing_to_change" });
    const retire = await propose("units.retire", { tool_id: t.id, unit_id: unit.id }, identity);
    if (!retire.ok) throw new Error(retire.error);
    expect(retire.proposals[0].preview.rows).toEqual([{ field: "unitStatus", before: "available", after: "retired", format: "unitStatus" }]);
  });
});
