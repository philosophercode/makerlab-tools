// @vitest-environment node
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { eq } from "drizzle-orm";
import { fakeEmbeddingTarget } from "../../../test/ai/fake-embeddings";
import { recordedCalls, textModel } from "../../../test/ai/models-stub";
import { seedManual, seedTool } from "../../../test/manuals/seed";
import { listEvalQuestions } from "../data/manual-eval-questions";
import { createPgliteDb } from "../db/pglite";
import { attachments, manualEvalQuestions, manualPages, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { generateDocumentQuestions } from "./eval-questions";
import { buildDocumentPassages } from "./passages";

/**
 * Eval questions from a manual (manual text spec amendment 2026-10-07):
 * written once per text from the stored passages, tied to their pages,
 * replaced when the text changes, copied for the same text on another
 * machine, and every failure a value. PGlite in process; the model is a stub.
 */

const PAGE = (title: string, body: string) => `${title}\n${body} ${body} ${body}`;
const PAGES = [
  "Contents\nSafety 2\nSetup 3\nPrinting 4\nMaintenance 5",
  PAGE("Safety", "Wear gloves and safety glasses when you handle resin. Keep the area ventilated and never eat near the printer."),
  PAGE("Setup", "Place the printer on a level, stable surface away from direct sunlight, with room behind it for the cables."),
  PAGE("Printing", "Shake the cartridge, insert it until it clicks, then choose the file on the touchscreen and press print."),
  PAGE("Maintenance", "Lift the resin tank straight up out of the carrier, keep it level, and slide the new tank in until the tabs seat."),
];
const OUTLINE = [
  { title: "Safety", page: 2, level: 1 },
  { title: "Setup", page: 3, level: 1 },
  { title: "Printing", page: 4, level: 1 },
  { title: "Maintenance", page: 5, level: 1 },
];

/** An answer naming the passages the prompt offered, by their section titles. */
function answerFor(prompt: string, questions: Record<string, string>): string {
  const offered = [...prompt.matchAll(/source="(P\d+) - ([^"/]+?)(?: \/ [^"]*)? - page/g)].map((m) => ({ label: m[1], section: m[2].trim() }));
  return JSON.stringify({
    questions: offered
      .filter((p) => questions[p.section])
      .map((p) => ({ passage: p.label, question: questions[p.section], answer: `See ${p.section}.`, answerable_from_passage: true })),
  });
}

const QUESTIONS: Record<string, string> = {
  Safety: "What should I wear when I handle resin?",
  Setup: "Where should I put the printer?",
  Printing: "How do I start a print?",
  Maintenance: "How do I swap the resin tank?",
};

function questionModel(questions: Record<string, string> = QUESTIONS) {
  return new MockLanguageModelV3({
    provider: "gateway",
    modelId: "stub/questions",
    doGenerate: async (options) => {
      const prompt = JSON.stringify(options.prompt).replace(/\\"/g, '"');
      return {
        content: [{ type: "text", text: answerFor(prompt, questions) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 900, noCache: 900, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 300, text: 300, reasoning: 0 } },
        providerMetadata: { gateway: { cost: "0.00025", serviceTier: "flex" } },
        warnings: [],
      };
    },
  });
}

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("MANUAL_EVAL_QUESTIONS", "");
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(tools);
  toolId = await seedTool(db, { name: "Form 4", slug: "form-4" });
});

afterEach(() => vi.unstubAllEnvs());

async function seedSearchable(pages = PAGES, onTool = toolId, title = "Form 4 Manual") {
  const seeded = await seedManual(db, { toolId: onTool, title, pages, outline: OUTLINE });
  const built = await buildDocumentPassages(db, seeded.documentId, { target: fakeEmbeddingTarget() });
  expect(built.status).toBe("built");
  return seeded;
}

describe("generateDocumentQuestions", () => {
  it("writes questions from the passages, each with its page, passage and answer, and logs the cost", async () => {
    const { documentId } = await seedSearchable();
    const model = questionModel();
    const outcome = await generateDocumentQuestions(db, documentId, { model, count: 2 });
    expect(outcome).toMatchObject({ status: "written", questions: 2, inputTokens: 900, outputTokens: 300, cost: 0.00025, model: "gateway/stub/questions" });

    // Four askable sections: two questions, from different sections, and the contents page never offered.
    const prompt = JSON.stringify(recordedCalls(model)[0].prompt);
    expect(prompt).not.toContain("Contents");
    expect(recordedCalls(model)[0].providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
    const stored = await db.select().from(manualEvalQuestions).where(eq(manualEvalQuestions.documentId, documentId));
    expect(stored).toHaveLength(2);
    for (const row of stored) {
      expect(row.toolId).toBe(toolId);
      expect(row.sourceHash).toMatch(/^sha256:/);
      expect(row.expectedPages).toHaveLength(1);
      expect(Object.values(QUESTIONS)).toContain(row.question);
      expect(row.expectedAnswer).toBe(`See ${row.sectionPath[0]}.`);
      const page = row.expectedPages[0];
      expect(PAGES[page - 1]).toContain(row.sectionPath[0]);
    }
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/eval questions written: .* questions=2 .*cost \$0\.0003, tier flex/));
  });

  it("asks nothing again for the same text, a passage rebuild included, and replaces the questions when the text changes", async () => {
    const { documentId } = await seedSearchable();
    await generateDocumentQuestions(db, documentId, { model: questionModel(), count: 4 });
    const model = textModel("{}");
    await buildDocumentPassages(db, documentId, { target: fakeEmbeddingTarget(), force: true });
    expect(await generateDocumentQuestions(db, documentId, { model, count: 4 })).toEqual({ status: "skipped", documentId, reason: "up_to_date" });
    expect(recordedCalls(model)).toHaveLength(0);

    // The text changes: the old questions go, the new ones come from the new text.
    await db.update(manualPages).set({ text: PAGE("Maintenance", "Unscrew the four bolts and pull the tank forward out of its rails, then fit the new tank.") }).where(eq(manualPages.pageNumber, 5));
    await buildDocumentPassages(db, documentId, { target: fakeEmbeddingTarget(), force: true });
    const outcome = await generateDocumentQuestions(db, documentId, { model: questionModel({ Maintenance: "How do I get the tank out?" }), count: 4 });
    expect(outcome).toMatchObject({ status: "written", questions: 1 });
    const stored = await db.select().from(manualEvalQuestions).where(eq(manualEvalQuestions.documentId, documentId));
    expect(stored.map((row) => row.question)).toEqual(["How do I get the tank out?"]);
  });

  it("copies the questions of the same text on another machine, with no model call", async () => {
    const first = await seedSearchable();
    await generateDocumentQuestions(db, first.documentId, { model: questionModel(), count: 3 });
    const otherTool = await seedTool(db, { name: "Form 4B", slug: "form-4b" });
    const second = await seedSearchable(PAGES, otherTool, "Form 4B Manual");
    const model = textModel("{}");
    expect(await generateDocumentQuestions(db, second.documentId, { model, count: 3 })).toEqual({
      status: "copied",
      documentId: second.documentId,
      questions: 2,
    });
    expect(recordedCalls(model)).toHaveLength(0);
    const copied = await db.select().from(manualEvalQuestions).where(eq(manualEvalQuestions.documentId, second.documentId));
    expect(copied.map((row) => row.toolId)).toEqual([otherTool, otherTool]);
  });

  it("does nothing when switched off, for a document without passages, or for one with nothing to ask", async () => {
    const { documentId } = await seedSearchable();
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "0");
    expect(await generateDocumentQuestions(db, documentId, { model: questionModel() })).toEqual({ status: "skipped", documentId, reason: "disabled" });
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "");

    const textOnly = await seedManual(db, { toolId, title: "Unindexed", pages: PAGES });
    expect(await generateDocumentQuestions(db, textOnly.documentId, { model: questionModel() })).toMatchObject({ reason: "not_searchable" });

    const legal = await seedSearchable(["Warranty\nThe warranty covers defects for one year.", "Legal\nAll rights reserved."], toolId, "Legal notes");
    expect(await generateDocumentQuestions(db, legal.documentId, { model: questionModel() })).toMatchObject({ status: "skipped", reason: "nothing_to_ask" });
  });

  it("plans in a dry run: an estimate, no call, nothing written", async () => {
    const { documentId } = await seedSearchable();
    const model = textModel("{}");
    const outcome = await generateDocumentQuestions(db, documentId, { model, count: 4, dryRun: true });
    expect(outcome).toMatchObject({ status: "planned", questions: 2, passages: 4 });
    if (outcome.status !== "planned") throw new Error("not planned");
    expect(outcome.estimatedInputTokens).toBeGreaterThan(200);
    expect(outcome.estimatedOutputTokens).toBeGreaterThan(0);
    expect(recordedCalls(model)).toHaveLength(0);
    expect(await db.select().from(manualEvalQuestions)).toHaveLength(0);
  });

  it("answers a rate limit as a transient failure and an unreadable answer as a permanent one, keeping earlier questions", async () => {
    const { documentId } = await seedSearchable();
    const limited = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new APICallError({ message: "slow down", url: "https://ai-gateway.vercel.sh", requestBodyValues: {}, statusCode: 429, isRetryable: false });
      },
    });
    expect(await generateDocumentQuestions(db, documentId, { model: limited })).toEqual({
      status: "failed",
      documentId,
      reason: "model",
      kind: "rate_limited",
      transient: true,
    });
    expect(await generateDocumentQuestions(db, documentId, { model: textModel("I would rather not.") })).toEqual({
      status: "failed",
      documentId,
      reason: "unreadable",
      kind: null,
      transient: false,
    });
    expect(await db.select().from(manualEvalQuestions)).toHaveLength(0);
  });
});

describe("listEvalQuestions", () => {
  it("lists the questions of current documents, with whether a visitor can search them, narrowed by machine", async () => {
    const { documentId } = await seedSearchable();
    await generateDocumentQuestions(db, documentId, { model: questionModel(), count: 2 });
    const hidden = await seedManual(db, { toolId, title: "Staff notes", pages: PAGES.map((p) => `${p} staff`), outline: OUTLINE, access: "private" });
    await buildDocumentPassages(db, hidden.documentId, { target: fakeEmbeddingTarget() });
    await generateDocumentQuestions(db, hidden.documentId, { model: questionModel(), count: 1 });

    const all = await listEvalQuestions(db);
    expect(all).toHaveLength(3);
    expect(all.filter((q) => q.public).map((q) => q.documentId)).toEqual([documentId, documentId]);
    expect(all.find((q) => !q.public)?.documentTitle).toBe("Staff notes");
    expect(all[0]).toMatchObject({ toolSlug: "form-4", toolName: "Form 4" });
    expect(await listEvalQuestions(db, { toolSlug: "other" })).toEqual([]);
    expect(await listEvalQuestions(db, { limit: 1 })).toHaveLength(1);
  });
});
