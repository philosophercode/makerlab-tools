// @vitest-environment node
import { fakeEmbeddingTarget } from "../test/ai/fake-embeddings.ts";
import { recordedCalls, textModel } from "../test/ai/models-stub.ts";
import { seedManual, seedTool } from "../test/manuals/seed.ts";
import { listDocumentsForQuestions } from "../src/lib/data/manual-eval-questions.ts";
import { createPgliteDb } from "../src/lib/db/pglite.ts";
import { attachments, manualEvalQuestions, resources, tools } from "../src/lib/db/schema/index.ts";
import type { Db } from "../src/lib/db/types.ts";
import { buildDocumentPassages } from "../src/lib/manuals/passages.ts";
import { estimateUsd } from "../src/lib/ai/list-prices.ts";
import { parseArgs, runEvalQuestionsBackfill, summarise } from "./manual-eval-questions.ts";

/**
 * The eval question backfill (manual text spec amendment 2026-10-07): a dry
 * run by default that estimates the cost and writes nothing; `--apply`
 * writes; `--tool` narrows to one machine. PGlite in process, a stub model.
 */

const BODY = "Lift the resin tank straight up out of the carrier, keep it level so nothing spills, and slide the new one in until both tabs seat. ";
const PAGES = ["Replacing the tank\n" + BODY.repeat(3), "Cleaning\n" + BODY.replace("resin tank", "build platform").repeat(3)];
const OUTLINE = [
  { title: "Replacing the tank", page: 1, level: 1 },
  { title: "Cleaning", page: 2, level: 1 },
];

let db: Db;

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
  for (const [name, slug] of [["Form 4", "form-4"], ["Trotec Speedy 400", "trotec-speedy-400"]]) {
    const toolId = await seedTool(db, { name, slug });
    const { documentId } = await seedManual(db, { toolId, title: `${name} Manual`, pages: PAGES.map((p) => `${p} ${slug}`), outline: OUTLINE });
    await buildDocumentPassages(db, documentId, { target: fakeEmbeddingTarget() });
  }
});

afterEach(() => vi.unstubAllEnvs());

describe("parseArgs", () => {
  it("is a dry run by default and takes --apply, --tool, --limit and --force", () => {
    expect(parseArgs([])).toEqual({ apply: false, force: false, tool: null, limit: null });
    expect(parseArgs(["--apply", "--tool", "form-4", "--limit=3", "--force"])).toEqual({ apply: true, force: true, tool: "form-4", limit: 3 });
    expect(() => parseArgs(["--tool", "Form 4"])).toThrow(/slug/);
    expect(() => parseArgs(["--limit", "0"])).toThrow(/--limit/);
    expect(() => parseArgs(["--everything"])).toThrow(/Unknown argument/);
  });
});

describe("runEvalQuestionsBackfill", () => {
  it("dry run: estimates tokens and dollars at the job's model's list price, calls nothing, writes nothing", async () => {
    const model = textModel("{}");
    const documents = await listDocumentsForQuestions(db);
    expect(documents.map((d) => d.toolSlug)).toEqual(["form-4", "trotec-speedy-400"]);
    const lines: string[] = [];
    const report = await runEvalQuestionsBackfill({ db, documents, apply: false, model, log: (line) => lines.push(line) });
    expect(report).toMatchObject({ documents: 2, planned: 2, questions: 2, written: 0 });
    expect(report.inputTokens).toBeGreaterThan(0);
    expect(report.model).toBe("anthropic/claude-opus-5.5");
    expect(report.estimatedUsd).toBeCloseTo(estimateUsd(report.model, report.inputTokens, report.outputTokens)!, 10);
    expect(lines[0]).toMatch(/^\[1\/2\] form-4 · document [0-9a-f-]+: would ask for 1 question\(s\) from 2 passages/);
    expect(summarise(report, false)).toMatch(/^Dry run: 2 manual\(s\) would get 2 question\(s\).*~\$\d+\.\d{4} at anthropic\/claude-opus-5\.5's list price.*--apply/);
    expect(recordedCalls(model)).toHaveLength(0);
    expect(await db.select().from(manualEvalQuestions)).toHaveLength(0);
  });

  it("--apply writes, --tool narrows, and a second run finds nothing to do", async () => {
    const answer = JSON.stringify({ questions: [{ passage: "P1", question: "How do I swap the tank?", answer: "Lift it out, slide the new one in.", answerable_from_passage: true }] });
    const documents = await listDocumentsForQuestions(db, { toolSlug: "form-4" });
    expect(documents).toHaveLength(1);
    const report = await runEvalQuestionsBackfill({ db, documents, apply: true, model: textModel(answer) });
    expect(report).toMatchObject({ written: 1, questions: 1, failed: 0 });
    expect(summarise(report, true)).toMatch(/^Wrote 1 question\(s\) for 1 manual\(s\)/);
    expect(await db.select().from(manualEvalQuestions)).toHaveLength(1);

    const again = await runEvalQuestionsBackfill({ db, documents, apply: true, model: textModel(answer) });
    expect(again).toMatchObject({ written: 0, upToDate: 1 });
  });

  it("counts a failure and goes on; the same command again retries only what failed", async () => {
    const documents = await listDocumentsForQuestions(db);
    const answer = JSON.stringify({ questions: [{ passage: "P1", question: "How do I swap the tank?", answer: "Lift it out, slide the new one in.", answerable_from_passage: true }] });
    // The second manual's answer cannot be read.
    const flaky = textModel((i) => (i === 0 ? answer : "no json here"));
    const report = await runEvalQuestionsBackfill({ db, documents, apply: true, model: flaky });
    expect(report).toMatchObject({ failed: 1, written: 1 });
    expect(summarise(report, true)).toContain("1 failed");
    expect(summarise(report, true)).toContain("Run the same command again to retry the 1 that failed");

    const resumed = textModel(answer);
    const again = await runEvalQuestionsBackfill({ db, documents, apply: true, model: resumed });
    expect(again).toMatchObject({ upToDate: 1, written: 1, failed: 0 });
    expect(recordedCalls(resumed)).toHaveLength(1);
  });
});
