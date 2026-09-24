// @vitest-environment node
import { eq } from "drizzle-orm";
import { fakeEmbeddingTarget, hashedBagOfWords, oneHot } from "../../../test/ai/fake-embeddings";
import { seedManual, seedTool } from "../../../test/manuals/seed";
import { createPgliteDb } from "../db/pglite";
import { attachments, manualChunks, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { buildDocumentPassages } from "./passages";
import { mergeAdjacent, partNumberTokens, searchManuals, type ManualPassage } from "./search";

/**
 * Hybrid manual search (manual text spec §3.5, §8, §10) on PGlite with
 * pgvector and a fake embedding model: fusion order, tool scoping, access in
 * the SQL, archived tools, exact part-number matches, merging, and the
 * full-text fallback when the query cannot be embedded.
 */

const staff = { role: "admin" as const };
const student = { role: "user" as const };
const anonymous = { role: "anonymous" as const };

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(tools);
});

afterEach(() => vi.restoreAllMocks());

const target = fakeEmbeddingTarget();

async function manual(toolId: string, title: string, pages: string[], extra: Partial<Parameters<typeof seedManual>[1]> = {}) {
  const seeded = await seedManual(db, { toolId, title, pages, ...extra });
  const built = await buildDocumentPassages(db, seeded.documentId, { target });
  expect(built.status).toBe("built");
  return seeded;
}

const RESIN = "Replacing the resin tank. Lift the resin tank straight up out of the printer and set it on a flat surface.";
const CLEAN = "Cleaning the build platform. Wipe the build platform with isopropyl alcohol after every print.";
const ERROR = "Error E-302 means the cartridge is not seated. Push cartridge 3401-038 down until it clicks.";

describe("searchManuals", () => {
  it("finds the passage by meaning and by words, with its page, section and a #page link", async () => {
    const form4 = await seedTool(db, { name: "Form 4" });
    const seeded = await manual(form4, "Form 4 Manual", [CLEAN, RESIN, ERROR], {
      outline: [
        { title: "Cleaning", page: 1, level: 1 },
        { title: "Resin tank", page: 2, level: 1 },
        { title: "Errors", page: 3, level: 1 },
      ],
    });
    const { passages, vectorFailed } = await searchManuals(db, { query: "how do I replace the resin tank", viewer: anonymous, target });
    expect(vectorFailed).toBe(false);
    expect(passages[0]).toMatchObject({
      toolName: "Form 4",
      toolSlug: "form-4",
      documentTitle: "Form 4 Manual",
      sectionPath: ["Resin tank"],
      pageStart: 2,
      pageEnd: 2,
      pdfUrl: `${seeded.publicUrl}#page=2`,
    });
    expect(passages[0].content).toContain("Lift the resin tank");
  });

  it("fuses the lists: a passage both lists rank beats one only one list finds", async () => {
    const tool = await seedTool(db, { name: "Acme" });
    // Pin the vectors: the query and passage B share an axis; A only has the words.
    const pinned = fakeEmbeddingTarget({
      vectorFor: (text) => (text.includes("zebra") || text.includes("walrus") ? oneHot(7) : oneHot(99)),
    });
    const doc = await seedManual(db, {
      toolId: tool,
      title: "Acme Guide",
      pages: ["Alpha passage about the walrus valve only.", "Beta passage about the walrus valve and the zebra.", "Gamma passage."],
      outline: [
        { title: "A", page: 1, level: 1 },
        { title: "B", page: 2, level: 1 },
        { title: "C", page: 3, level: 1 },
      ],
    });
    await buildDocumentPassages(db, doc.documentId, { target: pinned });
    const vectorOnly = await searchManuals(db, { query: "zebra", mode: "vector", viewer: staff, target: pinned });
    expect(vectorOnly.passages.slice(0, 2).map((p) => p.sectionPath[0]).sort()).toEqual(["A", "B"]);
    const fts = await searchManuals(db, { query: "zebra", mode: "fts", viewer: staff, target: pinned });
    expect(fts.passages.map((p) => p.sectionPath[0])).toEqual(["B"]);
    const hybrid = await searchManuals(db, { query: "zebra", viewer: staff, target: pinned });
    expect(hybrid.passages[0].sectionPath).toEqual(["B"]);
    expect(hybrid.passages[0].score).toBeGreaterThan(hybrid.passages[1].score);
  });

  it("matches part numbers and error codes exactly", async () => {
    const tool = await seedTool(db, { name: "Form 4" });
    await manual(tool, "Form 4 Manual", [CLEAN, RESIN, ERROR], {
      outline: [
        { title: "Cleaning", page: 1, level: 1 },
        { title: "Resin tank", page: 2, level: 1 },
        { title: "Errors", page: 3, level: 1 },
      ],
    });
    const byCode = await searchManuals(db, { query: "E-302", mode: "fts", viewer: anonymous, target });
    expect(byCode.passages[0].pageStart).toBe(3);
    const byPart = await searchManuals(db, { query: "where does 3401-038 go", mode: "fts", viewer: anonymous, target });
    expect(byPart.passages[0].pageStart).toBe(3);
    expect(partNumberTokens("error E-302 on part 3401-038, M3x8 screw, code 0300 and 12")).toEqual([
      "E-302",
      "3401-038",
      "M3x8",
      "0300",
    ]);
  });

  it("scopes to the tools asked for", async () => {
    const form4 = await seedTool(db, { name: "Form 4" });
    const laser = await seedTool(db, { name: "Trotec" });
    await manual(form4, "Form 4 Manual", [RESIN]);
    await manual(laser, "Trotec Manual", ["Replacing the lens. Unscrew the lens holder and lift the resin tank of the laser."]);
    const scoped = await searchManuals(db, { query: "resin tank", toolIds: [laser], viewer: anonymous, target });
    expect(scoped.passages.length).toBeGreaterThan(0);
    expect(new Set(scoped.passages.map((p) => p.toolName))).toEqual(new Set(["Trotec"]));
    const all = await searchManuals(db, { query: "resin tank", viewer: anonymous, target });
    expect(new Set(all.passages.map((p) => p.toolName))).toEqual(new Set(["Form 4", "Trotec"]));
    expect((await searchManuals(db, { query: "resin", toolIds: ["not-a-uuid"], viewer: anonymous, target })).passages).toEqual([]);
  });

  it("never lets a private SOP, a hidden resource or a draft tool reach anyone but lab staff", async () => {
    const tool = await seedTool(db, { name: "Form 4" });
    const draft = await seedTool(db, { name: "Draft Printer", published: false });
    await manual(tool, "Form 4 Manual", [RESIN]);
    await manual(tool, "Internal SOP", ["Staff only: the secret resin tank torque is 12 Nm."], { access: "private" });
    await manual(tool, "Hidden guide", ["Hidden resin tank guide text for the tank."], { published: false });
    await manual(draft, "Draft manual", ["Draft resin tank instructions."]);

    for (const viewer of [anonymous, student, null]) {
      const { passages } = await searchManuals(db, { query: "resin tank", viewer, target });
      expect(passages.map((p) => p.documentTitle)).toEqual(["Form 4 Manual"]);
    }
    const { passages } = await searchManuals(db, { query: "resin tank", viewer: staff, target });
    expect(new Set(passages.map((p) => p.documentTitle))).toEqual(
      new Set(["Form 4 Manual", "Internal SOP", "Hidden guide", "Draft manual"])
    );
    const sop = passages.find((p) => p.documentTitle === "Internal SOP") as ManualPassage;
    expect(sop.pdfUrl).toBeNull();
  });

  it("excludes archived tools and stale archive copies", async () => {
    const tool = await seedTool(db, { name: "Old Printer", archived: true });
    await manual(tool, "Old manual", [RESIN]);
    expect((await searchManuals(db, { query: "resin tank", viewer: staff, target })).passages).toEqual([]);

    const live = await seedTool(db, { name: "Form 4" });
    const seeded = await manual(live, "Form 4 Manual", [RESIN]);
    // The resource's link moved on: its archive copy of the old link is stale.
    await db.update(resources).set({ url: "https://maker.test/new.pdf" }).where(eq(resources.id, seeded.resourceId));
    await db
      .update(attachments)
      .set({ sourceKey: `manual:${seeded.resourceId}:https://maker.test/old.pdf` })
      .where(eq(attachments.id, seeded.attachmentId));
    expect((await searchManuals(db, { query: "resin tank", viewer: staff, target })).passages).toEqual([]);
  });

  it("falls back to full text when the query cannot be embedded", async () => {
    const tool = await seedTool(db, { name: "Form 4" });
    await manual(tool, "Form 4 Manual", [CLEAN, RESIN]);
    const broken = { ...target, model: fakeEmbeddingTarget({ fail: () => new Error("fetch failed") }).model };
    const result = await searchManuals(db, { query: "resin tank", viewer: anonymous, target: broken });
    expect(result.vectorFailed).toBe(true);
    expect(result.passages[0].content).toContain("resin tank");
  });

  it("returns nothing for an empty query, and caps the limit", async () => {
    const tool = await seedTool(db, { name: "Form 4" });
    await manual(tool, "Form 4 Manual", Array.from({ length: 12 }, (_, i) => `Page ${i} about the resin tank and step ${i}.`), {
      outline: Array.from({ length: 12 }, (_, i) => ({ title: `Section ${i}`, page: i + 1, level: 1 })),
    });
    expect((await searchManuals(db, { query: "   ", viewer: anonymous, target })).passages).toEqual([]);
    const { passages } = await searchManuals(db, { query: "resin tank", viewer: anonymous, target, limit: 3 });
    expect(passages).toHaveLength(3);
    expect((await searchManuals(db, { query: "resin tank", viewer: anonymous, target })).passages).toHaveLength(8);
  });
});

describe("mergeAdjacent", () => {
  const base: ManualPassage = {
    documentId: "d",
    toolId: null,
    toolName: null,
    toolSlug: null,
    documentTitle: "Doc",
    sectionPath: ["S"],
    pageStart: 1,
    pageEnd: 1,
    pageLabel: null,
    content: "",
    pdfUrl: null,
    score: 0,
    ordinals: [0],
  };

  it("joins consecutive passages of one section without repeating the overlap, keeping the best score", () => {
    const merged = mergeAdjacent([
      { ...base, ordinals: [4], pageStart: 3, pageEnd: 3, content: "First part. The shared overlap sentence here.", score: 0.02 },
      { ...base, ordinals: [5], pageStart: 3, pageEnd: 4, content: "The shared overlap sentence here.\nSecond part.", score: 0.03 },
      { ...base, ordinals: [9], pageStart: 7, pageEnd: 7, content: "Far away.", score: 0.01 },
      { ...base, ordinals: [6], sectionPath: ["Other"], content: "Other section.", score: 0.025 },
    ]);
    expect(merged.map((p) => p.ordinals)).toEqual([[4, 5], [6], [9]]);
    expect(merged[0]).toMatchObject({
      pageStart: 3,
      pageEnd: 4,
      score: 0.03,
      content: "First part. The shared overlap sentence here.\nSecond part.",
    });
  });
});

describe("fake embeddings", () => {
  it("are deterministic and unit length", () => {
    const a = hashedBagOfWords("resin tank");
    expect(a).toEqual(hashedBagOfWords("resin tank"));
    expect(Math.hypot(...a)).toBeCloseTo(1);
    expect(a).toHaveLength(512);
  });

  it("rebuilt passages replace the old ones", async () => {
    const tool = await seedTool(db, { name: "Form 4" });
    const seeded = await manual(tool, "Form 4 Manual", [RESIN]);
    const before = await db.select().from(manualChunks).where(eq(manualChunks.documentId, seeded.documentId));
    await buildDocumentPassages(db, seeded.documentId, { target, force: true });
    const after = await db.select().from(manualChunks).where(eq(manualChunks.documentId, seeded.documentId));
    expect(after).toHaveLength(before.length);
    expect(after.map((c) => c.id)).not.toEqual(before.map((c) => c.id));
  });
});
