// @vitest-environment node
import { eq } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { categories, categoryProposals, tools } from "../db/schema";
import type { Db } from "../db/types";
import {
  countPendingCategoryProposals,
  createCategoryProposal,
  decideCategoryProposal,
  editCategory,
  findCategory,
  listAdminCategories,
  listCategoryProposals,
  mergeCategories,
  setCategoryRetired,
} from "./category-admin";

/** The taxonomy's writes (taxonomy v2 spec §4, §5.3): proposals, decisions, merges, retirement. */

let db: Db;
let powerTools: string;
let sanders: string;
let drills: string;

beforeEach(async () => {
  db = await createPgliteDb();
  powerTools = (await db.insert(categories).values({ name: "Power Tools", slug: "power-tools", sortOrder: 10 }).returning())[0].id;
  sanders = (await db.insert(categories).values({ name: "Sanders", slug: "sanders", parentId: powerTools, sortOrder: 10 }).returning())[0].id;
  drills = (await db.insert(categories).values({ name: "Drills", slug: "drills", parentId: powerTools, sortOrder: 20 }).returning())[0].id;
});

async function tool(slug: string, categoryId: string | null, archived = false) {
  return (await db.insert(tools).values({ slug, name: slug, categoryId, archivedAt: archived ? new Date() : null }).returning())[0].id;
}

describe("createCategoryProposal", () => {
  it("records a proposal, and answers the one already waiting for the same name under the same parent", async () => {
    const first = await createCategoryProposal(db, { name: "Oscillating Tools", parentId: powerTools, source: "research", reason: "No fit" });
    const again = await createCategoryProposal(db, { name: " oscillating  tools ", parentId: powerTools, source: "mcp" });
    const elsewhere = await createCategoryProposal(db, { name: "Oscillating Tools", parentId: null, source: "chat" });
    expect(first).toMatchObject({ ok: true, created: true });
    expect(again).toEqual({ ok: true, id: (first as { id: string }).id, created: false });
    expect(elsewhere).toMatchObject({ ok: true, created: true });
    expect(await countPendingCategoryProposals({ db })).toBe(2);
  });

  it("keeps one pending audit flag per subject", async () => {
    const a = await createCategoryProposal(db, { kind: "review_category", name: "Drills", source: "audit", subjectType: "category", subjectId: drills, flag: "sparse" });
    const b = await createCategoryProposal(db, { kind: "review_category", name: "Drills", source: "audit", subjectType: "category", subjectId: drills, flag: "sparse" });
    expect(b).toEqual({ ok: true, id: (a as { id: string }).id, created: false });
  });

  it("refuses a blank name", async () => {
    expect(await createCategoryProposal(db, { name: "  ", source: "gui" })).toEqual({ ok: false, reason: "invalid_field" });
  });
});

describe("decideCategoryProposal", () => {
  it("accept creates the category with a fresh slug and moves the tool that is still where approval put it", async () => {
    const toolId = await tool("multi-tool", sanders);
    const proposal = await createCategoryProposal(db, {
      name: "Oscillating Tools",
      parentId: powerTools,
      source: "research",
      subjectType: "tool",
      subjectId: toolId,
      nearestExistingId: sanders,
    });
    const decided = await decideCategoryProposal(db, { proposalId: (proposal as { id: string }).id, decision: "accept", description: "Multi-tools." });
    expect(decided).toMatchObject({ ok: true, status: "accepted", movedTool: true });
    const created = await findCategory("oscillating-tools", { db });
    expect(created).toMatchObject({ name: "Oscillating Tools", parentId: powerTools, description: "Multi-tools.", sortOrder: 30 });
    const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
    expect(row.categoryId).toBe(created!.id);
    expect(await decideCategoryProposal(db, { proposalId: (proposal as { id: string }).id, decision: "reject" })).toEqual({ ok: false, reason: "already_decided" });
  });

  it("leaves a tool somebody moved since approval where they put it", async () => {
    const toolId = await tool("multi-tool", drills);
    const proposal = await createCategoryProposal(db, { name: "Oscillating", parentId: powerTools, source: "research", subjectType: "tool", subjectId: toolId, nearestExistingId: sanders });
    const decided = await decideCategoryProposal(db, { proposalId: (proposal as { id: string }).id, decision: "accept" });
    expect(decided).toMatchObject({ ok: true, movedTool: false });
    const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
    expect(row.categoryId).toBe(drills);
  });

  it("accept refuses a name taken under the parent, a grandchild, and an audit flag", async () => {
    const dup = await createCategoryProposal(db, { name: "Sanders", parentId: powerTools, source: "gui" });
    expect(await decideCategoryProposal(db, { proposalId: (dup as { id: string }).id, decision: "accept" })).toEqual({ ok: false, reason: "duplicate_name" });
    const deep = await createCategoryProposal(db, { name: "Belt", parentId: sanders, source: "gui" });
    expect(await decideCategoryProposal(db, { proposalId: (deep as { id: string }).id, decision: "accept" })).toEqual({ ok: false, reason: "invalid_field" });
    const flag = await createCategoryProposal(db, { kind: "review_category", name: "Drills", source: "audit", subjectType: "category", subjectId: drills, flag: "sparse" });
    expect(await decideCategoryProposal(db, { proposalId: (flag as { id: string }).id, decision: "accept" })).toEqual({ ok: false, reason: "invalid_decision" });
  });

  it("merge sends the tool to an existing category instead", async () => {
    const toolId = await tool("multi-tool", sanders);
    const proposal = await createCategoryProposal(db, { name: "Oscillating", parentId: powerTools, source: "mcp", subjectType: "tool", subjectId: toolId, nearestExistingId: sanders });
    const decided = await decideCategoryProposal(db, { proposalId: (proposal as { id: string }).id, decision: "merge", targetCategoryId: drills });
    expect(decided).toMatchObject({ ok: true, status: "merged", categoryId: drills, movedTool: true });
  });

  it("merge on an audit flag merges the flagged category", async () => {
    await tool("one-drill", drills);
    const flag = await createCategoryProposal(db, { kind: "review_category", name: "Drills", source: "audit", subjectType: "category", subjectId: drills, flag: "sparse" });
    const decided = await decideCategoryProposal(db, { proposalId: (flag as { id: string }).id, decision: "merge", targetCategoryId: sanders });
    expect(decided).toMatchObject({ ok: true, status: "merged" });
    const merged = await findCategory(drills, { db });
    expect(merged?.retiredAt).toBeInstanceOf(Date);
    expect(merged?.mergedIntoId).toBe(sanders);
  });

  it("reject only records the decision", async () => {
    const proposal = await createCategoryProposal(db, { name: "Nope", source: "chat" });
    expect(await decideCategoryProposal(db, { proposalId: (proposal as { id: string }).id, decision: "reject" })).toMatchObject({ ok: true, status: "rejected" });
    const listed = await listCategoryProposals({ db });
    expect(listed[0]).toMatchObject({ name: "Nope", status: "rejected" });
    expect(await db.select().from(categories)).toHaveLength(3);
  });
});

describe("mergeCategories", () => {
  it("moves every tool, retires the source with merged_into_id and re-points waiting proposals", async () => {
    await tool("a", drills);
    await tool("b", drills, true);
    await createCategoryProposal(db, { name: "X", source: "research", nearestExistingId: drills });
    const merged = await mergeCategories(db, { fromId: drills, intoId: sanders });
    expect(merged).toEqual({ ok: true, movedTools: 2 });
    const [proposal] = await db.select().from(categoryProposals);
    expect(proposal.nearestExistingId).toBe(sanders);
  });

  it("refuses itself, a retired target, and a parent with live children", async () => {
    expect(await mergeCategories(db, { fromId: drills, intoId: drills })).toEqual({ ok: false, reason: "invalid_field" });
    expect(await mergeCategories(db, { fromId: powerTools, intoId: sanders })).toEqual({ ok: false, reason: "invalid_field" });
    const other = (await db.insert(categories).values({ name: "Other", slug: "other" }).returning())[0].id;
    expect(await mergeCategories(db, { fromId: powerTools, intoId: other })).toEqual({ ok: false, reason: "has_children" });
    await setCategoryRetired(db, { id: other, retired: true });
    expect(await mergeCategories(db, { fromId: drills, intoId: other })).toEqual({ ok: false, reason: "retired_target" });
  });
});

describe("editCategory and setCategoryRetired", () => {
  it("renames and re-describes, refusing a sibling's name", async () => {
    expect(await editCategory(db, { id: drills, name: "Drills & Drivers", description: "Drills." })).toEqual({ ok: true, name: "Drills & Drivers" });
    expect(await editCategory(db, { id: drills, name: "sanders" })).toEqual({ ok: false, reason: "duplicate_name" });
    expect(await editCategory(db, { id: drills, name: "x".repeat(61) })).toEqual({ ok: false, reason: "invalid_field" });
  });

  it("retires only an empty category, and restores it", async () => {
    await tool("a", drills);
    expect(await setCategoryRetired(db, { id: drills, retired: true })).toEqual({ ok: false, reason: "not_empty" });
    expect(await setCategoryRetired(db, { id: sanders, retired: true })).toEqual({ ok: true });
    expect(await setCategoryRetired(db, { id: powerTools, retired: true })).toEqual({ ok: false, reason: "has_children" });
    const listed = await listAdminCategories({ db });
    expect(listed.find((row) => row.id === sanders)?.retiredAt).toBeInstanceOf(Date);
    expect(listed.find((row) => row.id === drills)?.toolCount).toBe(1);
    expect(await setCategoryRetired(db, { id: sanders, retired: false })).toEqual({ ok: true });
    expect((await findCategory(sanders, { db }))?.retiredAt).toBeNull();
  });
});
