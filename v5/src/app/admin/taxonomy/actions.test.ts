// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));

/**
 * Withhold one permission, to prove each action asks for its own: admins hold
 * `tools.edit` and `taxonomy.manage` together, so only an override can show
 * that deciding checks the second. Null means the real `can()`.
 */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions ? override.permissions.has(permission) : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { resetAuthForTests } from "../../../lib/auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../../../lib/auth/identity";
import { decideActionProposals, proposeAction } from "../../../lib/actions/proposals";
import { actionById } from "../../../lib/actions/registry";
import { listAuditEvents } from "../../../lib/data/audit";
import { findCategory } from "../../../lib/data/category-admin";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { actionProposals, auditEvents, categories, categoryProposals, session, tools, user } from "../../../lib/db/schema/index";
import { signInAsNew } from "../../../../test/utils/session";
import {
  decideCategoryProposal,
  editCategory,
  mergeCategories,
  proposeCategory,
  recategorizeTool,
  setCategoryRetired,
} from "./actions";

/**
 * `/admin/taxonomy`'s server actions and the assistant's cards for the same
 * actions (taxonomy v2 spec §4.6): gated on `taxonomy.manage` (propose and move
 * on `tools.edit`), audited where structural, and — from a card — committed
 * only at the click. Real PGlite with the demo seed's v2 tree; the mirror is
 * stubbed.
 */

let db: Awaited<ReturnType<typeof getDb>>;

beforeEach(async () => {
  override.permissions = null;
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "taxonomy-actions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  db = await getDb();
  await db.delete(actionProposals);
  await db.delete(auditEvents);
  await db.delete(categoryProposals);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function signIn(role: "user" | "admin" | "super_admin"): Promise<Identity> {
  const signedIn = await signInAsNew({ email: `${role}@cornell.edu`, role, name: role });
  setMockHeaders({ cookie: signedIn.cookie });
  return resolveIdentityFromHeaders();
}

async function category(slug: string) {
  const found = await findCategory(slug, { db });
  if (!found) throw new Error(`no ${slug}`);
  return found;
}

describe("the proposals queue", () => {
  it("proposes from the page, then accepts: the category exists, the tool moves, and category.created is recorded", async () => {
    await signIn("admin");
    const power = await category("power-tools");
    const sanders = await category("sanders");
    const [tool] = await db.insert(tools).values({ slug: "multi-tool-x", name: "Multi-Tool X", categoryId: sanders.id }).returning();
    await db.insert(categoryProposals).values({
      name: "Oscillating Tools",
      parentId: power.id,
      source: "research",
      subjectType: "tool",
      subjectId: tool.id,
      nearestExistingId: sanders.id,
    });
    const [proposal] = await db.select().from(categoryProposals);

    expect(await decideCategoryProposal({ proposalId: proposal.id, decision: "accept" })).toMatchObject({ ok: true });
    const created = await category("oscillating-tools");
    expect(created.parentId).toBe(power.id);
    const [moved] = await db.select().from(tools).where(eq(tools.id, tool.id));
    expect(moved.categoryId).toBe(created.id);
    const events = await listAuditEvents({ db });
    expect(events.find((event) => event.action === "category.created")).toMatchObject({ subjectId: created.id, surface: "gui" });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/taxonomy");

    // Decided is decided.
    expect(await decideCategoryProposal({ proposalId: proposal.id, decision: "reject" })).toEqual({ ok: false, error: "already_decided" });
  });

  it("records a proposal from the page's form, and refuses a parent that is itself a child", async () => {
    await signIn("admin");
    const power = await category("power-tools");
    expect(await proposeCategory({ name: "Oscillating Tools", parentId: power.id, description: "Multi-tools.", reason: "No fit" })).toMatchObject({ ok: true });
    const [row] = await db.select().from(categoryProposals);
    expect(row).toMatchObject({ name: "Oscillating Tools", source: "gui", status: "pending" });
    const sanders = await category("sanders");
    expect(await proposeCategory({ name: "Belt", parentId: sanders.id })).toEqual({ ok: false, error: "invalid_field" });
  });

  it("refuses a student, and refuses deciding to somebody holding tools.edit but not taxonomy.manage", async () => {
    await signIn("user");
    expect(await proposeCategory({ name: "X" })).toEqual({ ok: false, error: "not_permitted" });
    await db.insert(categoryProposals).values({ name: "Y", source: "chat" });
    const [proposal] = await db.select().from(categoryProposals);
    expect(await decideCategoryProposal({ proposalId: proposal.id, decision: "reject" })).toEqual({ ok: false, error: "not_permitted" });

    await signIn("admin");
    override.permissions = new Set(["tools.edit"]);
    expect(await decideCategoryProposal({ proposalId: proposal.id, decision: "reject" })).toEqual({ ok: false, error: "not_permitted" });
    const sanders = await category("sanders");
    const drills = await category("drills-drivers");
    expect(await mergeCategories({ fromId: sanders.id, intoId: drills.id })).toEqual({ ok: false, error: "not_permitted" });
    expect(await setCategoryRetired({ categoryId: sanders.id, retired: true })).toEqual({ ok: false, error: "not_permitted" });
    expect(await editCategory({ categoryId: sanders.id, name: "Sanding" })).toEqual({ ok: false, error: "not_permitted" });
    // Proposing needs only tools.edit.
    expect(await proposeCategory({ name: "Z" })).toMatchObject({ ok: true });
  });
});

describe("the tree", () => {
  it("merges (tools move, the source retires, category.merged is recorded), renames and retires", async () => {
    await signIn("super_admin");
    const nailers = await category("nailers");
    const drills = await category("drills-drivers");
    await db.insert(tools).values({ slug: "brad-nailer", name: "Brad Nailer", categoryId: nailers.id });

    expect(await mergeCategories({ fromId: nailers.id, intoId: drills.id })).toMatchObject({ ok: true });
    expect((await category("nailers")).mergedIntoId).toBe(drills.id);
    const [moved] = await db.select().from(tools).where(eq(tools.slug, "brad-nailer"));
    expect(moved.categoryId).toBe(drills.id);
    expect((await listAuditEvents({ db })).find((event) => event.action === "category.merged")).toMatchObject({ subjectId: nailers.id });

    expect(await editCategory({ categoryId: drills.id, name: "Drills, Drivers & Nailers", description: "Anything that drives." })).toMatchObject({ ok: true });
    expect((await category("drills-drivers")).name).toBe("Drills, Drivers & Nailers");

    const ppe = await category("ppe");
    expect(await setCategoryRetired({ categoryId: ppe.id, retired: true })).toMatchObject({ ok: true });
    expect((await category("ppe")).retiredAt).toBeInstanceOf(Date);
    expect(await setCategoryRetired({ categoryId: drills.id, retired: true })).toEqual({ ok: false, error: "not_empty" });
  });

  it("moves a tool through the editor's revision check: a stale token is a conflict", async () => {
    await signIn("admin");
    const [tool] = await db.insert(tools).values({ slug: "mover", name: "Mover" }).returning();
    const saws = await category("hand-saws");
    const revision = (await readToolRevision(tool.id, { db }))!;
    expect(await recategorizeTool({ toolId: tool.id, expectedRevision: revision, categoryId: saws.id })).toMatchObject({ ok: true });
    expect(await recategorizeTool({ toolId: tool.id, expectedRevision: revision, categoryId: saws.id })).toEqual({ ok: false, error: "conflict" });
    const retired = await db.insert(categories).values({ name: "Old", slug: "old-x", retiredAt: new Date() }).returning();
    const fresh = (await readToolRevision(tool.id, { db }))!;
    expect(await recategorizeTool({ toolId: tool.id, expectedRevision: fresh, categoryId: retired[0].id })).toEqual({ ok: false, error: "retired_target" });
  });
});

describe("from the assistant", () => {
  it("only proposes: nothing changes until the click, and a merge needs the category's name typed", async () => {
    const identity = await signIn("admin");
    const nailers = await category("nailers");
    const proposed = await proposeAction(actionById("taxonomy.merge")!, { from: "nailers", into: "drills-drivers" }, { identity, surface: "assistant", chatId: "chat-1", tainted: false });
    if (!proposed.ok) throw new Error(proposed.error);
    expect((await category("nailers")).retiredAt).toBeNull();

    const refused = await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm", typed: "wrong" }, identity);
    expect(JSON.stringify(refused)).toMatch(/typed_name|mismatch|not_typed/);
    expect((await category("nailers")).retiredAt).toBeNull();

    await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm", typed: nailers.name }, identity);
    expect((await category("nailers")).mergedIntoId).toBe((await category("drills-drivers")).id);
    expect((await listAuditEvents({ db })).find((event) => event.action === "category.merged")).toMatchObject({ surface: "assistant" });
  });

  it("proposes a recategorisation by slug, never a new category", async () => {
    const identity = await signIn("admin");
    const [tool] = await db.insert(tools).values({ slug: "odd-saw", name: "Odd Saw" }).returning();
    const proposed = await proposeAction(
      actionById("taxonomy.recategorize_tool")!,
      { tool_ids: ["odd-saw"], category: "hand-saws" },
      { identity, surface: "assistant", chatId: "chat-1", tainted: false }
    );
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals[0]).toBeDefined();
    const unknown = await proposeAction(
      actionById("taxonomy.recategorize_tool")!,
      { tool_ids: ["odd-saw"], category: "saws-for-odd-things" },
      { identity, surface: "assistant", chatId: "chat-1", tainted: false }
    );
    expect(unknown.ok).toBe(false);
    await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, identity);
    const [moved] = await db.select().from(tools).where(eq(tools.id, tool.id));
    expect(moved.categoryId).toBe((await category("hand-saws")).id);
  });
});
