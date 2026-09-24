// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { pendingTools, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  findDuplicate,
  findDuplicates,
  normalizeToolName,
} from "./duplicates";

/**
 * The duplicate check (spec §5.4 step 4, §10 "The duplicate matcher") against
 * a real (in-process) Postgres with `pg_trgm`, because half of it is SQL: the
 * normalization has a TypeScript twin and a SQL twin, and they have to agree.
 */

let db: Db;
const OWNER = "dup-owner";

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: OWNER, name: "Owner", email: "owner@cornell.edu" });
});

beforeEach(async () => {
  await db.delete(pendingTools);
  await db.delete(tools);
});

async function tool(name: string, overrides: Partial<typeof tools.$inferInsert> = {}) {
  const [row] = await db
    .insert(tools)
    .values({ slug: `t-${crypto.randomUUID()}`, name, published: true, ...overrides })
    .returning({ id: tools.id, slug: tools.slug });
  return row;
}

async function pending(name: string, overrides: Partial<typeof pendingTools.$inferInsert> = {}) {
  const [row] = await db
    .insert(pendingTools)
    .values({ batchId: crypto.randomUUID(), name, createdBy: OWNER, ...overrides })
    .returning({ id: pendingTools.id, batchId: pendingTools.batchId });
  return row;
}

describe("normalizeToolName", () => {
  it("lower-cases, strips punctuation and collapses whitespace", () => {
    expect(normalizeToolName("  Trotec   Speedy-400,  80W ")).toBe("trotec speedy 400 80w");
    expect(normalizeToolName("Form_4")).toBe("form 4");
  });

  it("prefixes the brand unless the name already starts with it", () => {
    expect(normalizeToolName("X1-Carbon", "Bambu Lab")).toBe("bambu lab x1 carbon");
    expect(normalizeToolName("Bambu Lab X1-Carbon", "Bambu Lab")).toBe("bambu lab x1 carbon");
    expect(normalizeToolName("bambu-lab x1 carbon", "BAMBU LAB")).toBe("bambu lab x1 carbon");
    // A brand that is only a prefix of a word is not "already there".
    expect(normalizeToolName("Formlabs Form 4", "Form")).toBe("form formlabs form 4");
  });

  it("ignores a blank brand", () => {
    expect(normalizeToolName("Form 4", "  ")).toBe("form 4");
    expect(normalizeToolName("Form 4", null)).toBe("form 4");
  });
});

describe("findDuplicate", () => {
  it("matches brand-aware: X1-Carbon from Bambu Lab is the Bambu Lab X1-Carbon", async () => {
    const existing = await tool("Bambu Lab X1-Carbon");
    expect(await findDuplicate({ name: "X1-Carbon", brand: "Bambu Lab" }, { db })).toEqual({
      kind: "tool",
      id: existing.id,
      name: "Bambu Lab X1-Carbon",
      slug: existing.slug,
      published: true,
    });
  });

  it("matches a tool whose name omits the brand the query carries", async () => {
    const existing = await tool("Form 4");
    expect(await findDuplicate({ name: "Form 4", brand: "Formlabs" }, { db })).toMatchObject({
      id: existing.id,
    });
  });

  it("matches just above the threshold and not a clearly different machine", async () => {
    await tool("Prusa MK4S 3D Printer");
    // similarity("prusa mk4s 3d printer", "prusa mk4s") is 0.55 in pg_trgm.
    expect(DUPLICATE_SIMILARITY_THRESHOLD).toBe(0.5);
    expect(await findDuplicate({ name: "Prusa MK4S" }, { db })).toMatchObject({ kind: "tool" });
    expect(await findDuplicate({ name: "Trotec Speedy 400" }, { db })).toBeNull();
    // Same maker, different machine: 0.42, under the line.
    await db.delete(tools);
    await tool("Bambu Lab P1S");
    expect(await findDuplicate({ name: "Bambu Lab X1 Carbon" }, { db })).toBeNull();
  });

  it("matches drafts but not archived tools", async () => {
    const draft = await tool("Glowforge Pro", { published: false });
    expect(await findDuplicate({ name: "Glowforge Pro" }, { db })).toMatchObject({
      id: draft.id,
      published: false,
    });

    await db.delete(tools);
    await tool("Glowforge Pro", { archivedAt: new Date() });
    expect(await findDuplicate({ name: "Glowforge Pro" }, { db })).toBeNull();
  });

  it("matches pending items still in play, and not approved or discarded ones", async () => {
    const waiting = await pending("Roland VersaStudio BN-20", { status: "researched" });
    expect(await findDuplicate({ name: "Roland VersaStudio BN-20" }, { db })).toEqual({
      kind: "pending",
      id: waiting.id,
      name: "Roland VersaStudio BN-20",
      status: "researched",
    });

    await db.delete(pendingTools);
    await pending("Roland VersaStudio BN-20", { status: "approved" });
    await pending("Roland VersaStudio BN-20", { status: "discarded" });
    expect(await findDuplicate({ name: "Roland VersaStudio BN-20" }, { db })).toBeNull();
  });

  it("compares a pending item's own brand with the query's", async () => {
    const waiting = await pending("X1-Carbon", { brand: "Bambu Lab" });
    expect(await findDuplicate({ name: "Bambu Lab X1-Carbon" }, { db })).toMatchObject({
      id: waiting.id,
    });
    expect(await findDuplicate({ name: "X1 Carbon", brand: "bambu lab" }, { db })).toMatchObject({
      id: waiting.id,
    });
  });

  it("honours excludeBatchId and excludePendingIds", async () => {
    const mine = await pending("Ultimaker S5");
    expect(await findDuplicate({ name: "Ultimaker S5" }, { db, excludeBatchId: mine.batchId })).toBeNull();
    expect(await findDuplicate({ name: "Ultimaker S5" }, { db, excludePendingIds: [mine.id] })).toBeNull();
    expect(await findDuplicate({ name: "Ultimaker S5" }, { db })).toMatchObject({ id: mine.id });
  });

  it("prefers a tool over a pending item on a tie", async () => {
    await pending("Form 4");
    const existing = await tool("Form 4");
    expect(await findDuplicate({ name: "Form 4" }, { db })).toMatchObject({
      kind: "tool",
      id: existing.id,
    });
  });

  it("prefers an exact match over a closer-sounding near miss", async () => {
    await tool("Form 4L");
    const exact = await tool("Form-4");
    expect(await findDuplicate({ name: "form 4" }, { db })).toMatchObject({ id: exact.id });
  });

  it("answers each query in order, null where nothing matched", async () => {
    const existing = await tool("Trotec Speedy 400");
    const results = await findDuplicates(
      [{ name: "Something New Entirely" }, { name: "trotec speedy 400" }],
      { db }
    );
    expect(results).toEqual([null, expect.objectContaining({ id: existing.id })]);
    expect(await findDuplicates([], { db })).toEqual([]);
  });

  it("does not throw on a name with nothing to normalize", async () => {
    await tool("Form 4");
    expect(await findDuplicate({ name: "—" }, { db })).toBeNull();
  });
});
