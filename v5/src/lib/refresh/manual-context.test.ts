// @vitest-environment node
import { seedManual, seedTool } from "../../../test/manuals/seed";
import { createPgliteDb } from "../db/pglite";
import { manualDocuments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import type { ManualPassage, searchManuals } from "../manuals/search";
import { passagesText, REFRESH_MANUAL_QUERIES, toolManualContext } from "./manual-context";

/**
 * The tool's own manual in refresh research's read step (manual text spec
 * §3.7): outline plus the passages for the fixed queries, within the 16k
 * budget; the stored digest when there are no passages; nothing when the tool
 * has no processed manual.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(manualDocuments);
  await db.delete(resources);
  await db.delete(tools);
});

function passage(documentId: string, pageStart: number, content: string, ordinal: number): ManualPassage {
  return {
    documentId,
    toolId: null,
    toolName: "Form 4",
    toolSlug: "form-4",
    documentTitle: "Form 4 Manual",
    sectionPath: ["Specifications"],
    pageStart,
    pageEnd: pageStart,
    pageLabel: null,
    content,
    pdfUrl: null,
    score: 1,
    ordinals: [ordinal],
  };
}

it("gives the outline and the passages for the fixed queries, safety only as context", async () => {
  const toolId = await seedTool(db, { name: "Form 4" });
  const manual = await seedManual(db, {
    toolId,
    title: "Form 4 Manual",
    pages: ["Cover", "Build volume: 200 × 125 × 210 mm", "Warning: wear gloves when handling resin."],
    outline: [{ title: "Specifications", page: 2, level: 1 }],
  });
  const asked: string[] = [];
  const search = (async (_db, input) => {
    asked.push(input.query);
    expect(input.toolIds).toEqual([toolId]);
    if (input.query === "specifications") return { passages: [passage(manual.documentId, 2, "Build volume: 200 × 125 × 210 mm", 1)], vectorFailed: false, queryTokens: 1, cost: null };
    if (input.query === "technical data") return { passages: [passage(manual.documentId, 2, "Build volume: 200 × 125 × 210 mm", 1)], vectorFailed: false, queryTokens: 1, cost: null };
    if (input.query === "safety warnings") return { passages: [passage(manual.documentId, 3, "Warning: wear gloves when handling resin.", 2)], vectorFailed: false, queryTokens: 1, cost: null };
    return { passages: [passage("another-document", 9, "Somebody else's manual", 3)], vectorFailed: false, queryTokens: 1, cost: null };
  }) as typeof searchManuals;

  const context = await toolManualContext(db, toolId, { search });
  expect(asked).toEqual([...REFRESH_MANUAL_QUERIES]);
  expect(context).toMatchObject({ url: manual.publicUrl, title: "Form 4 Manual", mode: "passages" });
  expect(context?.urls).toContain(manual.publicUrl);
  expect(context?.text).toContain("Contents:\n- Specifications (p. 2)");
  // Each passage once, however many queries found it; other documents never.
  expect(context?.text.match(/Build volume/g)).toHaveLength(1);
  expect(context?.text).not.toContain("Somebody else's manual");
  expect(context?.text).toMatch(/\[page 3 — Specifications\] \(safety context only — staff set protective equipment; do not propose PPE\)/);
});

it("falls back to the stored digest when the manual has no passages yet", async () => {
  const toolId = await seedTool(db, { name: "Form 4" });
  await seedManual(db, { toolId, title: "Form 4 Manual", pages: ["Cover page text", "Build volume: 200 × 125 × 210 mm\nLaser power: 250 mW"] });
  const search = (async () => ({ passages: [], vectorFailed: false, queryTokens: 0, cost: null })) as typeof searchManuals;
  const context = await toolManualContext(db, toolId, { search });
  expect(context?.mode).toBe("digest");
  expect(context?.text).toContain("[page 2]");
  expect(context?.text).toContain("Laser power: 250 mW");
});

it("is null for a tool with no processed manual, and when the search throws it still uses the digest", async () => {
  const toolId = await seedTool(db, { name: "Trotec Speedy 400" });
  expect(await toolManualContext(db, toolId)).toBeNull();
  await seedManual(db, { toolId, title: "Speedy manual", pages: ["Work area: 1000 × 610 mm"] });
  const failing = (async () => {
    throw new Error("database gone");
  }) as unknown as typeof searchManuals;
  expect((await toolManualContext(db, toolId, { search: failing }))?.mode).toBe("digest");
});

it("keeps within the budget", () => {
  const long = "x".repeat(3000);
  const text = passagesText(
    { outline: [] },
    Array.from({ length: 10 }, (_, n) => ({ passage: passage("d", n + 1, long, n), contextOnly: false })),
    16_000
  );
  expect(text.length).toBeLessThanOrEqual(16_000);
  expect(text.match(/\[page/g)!.length).toBe(5);
});
