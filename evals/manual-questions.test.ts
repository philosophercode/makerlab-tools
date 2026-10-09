// @vitest-environment node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeEmbeddingTarget } from "../test/ai/fake-embeddings";
import { nextCacheMock } from "../test/mocks/next-cache";
import { getCatalogTools } from "@/lib/catalog";
import type { StoredEvalQuestion } from "@/lib/data/manual-eval-questions";
import { getDb } from "@/lib/db/client";
import { getNotionEnvContract } from "@/lib/notion";
import { buildFixture } from "./fixtures";
import { seedEvalManual, stopEvalManualServer } from "./manual-fixture";
import { FIXTURE_QUESTIONS, seedEvalManualQuestions } from "./manual-questions-fixture";
import {
  assessAnswer,
  formatManualQuestionReport,
  parseManualQuestionEvalEnv,
  recallKs,
  runManualQuestionEval,
  type AnswerRun,
} from "./manual-questions";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The manual question eval (manual text spec amendment 2026-10-07), offline:
 * the eval's Form 4 manual and scan seeded on the demo database with a hashed
 * bag-of-words embedding, the hand-written fixture questions and no reranker.
 * So the whole run, retrieval and end to end with a stubbed answer, needs no
 * network and no model, as `EVAL_MQ_FIXTURES=1 EVAL_MQ_OFFLINE=1` does.
 */

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "");
  for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
});

afterAll(async () => {
  await stopEvalManualServer();
});

describe("parseManualQuestionEvalEnv", () => {
  it("reads the options, with defaults, and refuses what cannot work", () => {
    expect(parseManualQuestionEvalEnv({})).toEqual({ e2e: false, fixtures: false, offline: false, tool: null, k: 8, limit: null, rerank: true, judge: false });
    expect(parseManualQuestionEvalEnv({ EVAL_MQ_E2E: "1", EVAL_MQ_JUDGE: "1" })).toMatchObject({ e2e: true, judge: true });
    expect(() => parseManualQuestionEvalEnv({ EVAL_MQ_JUDGE: "1" })).toThrow(/EVAL_MQ_E2E/);
    expect(
      parseManualQuestionEvalEnv({ EVAL_MQ_E2E: "1", EVAL_MQ_TOOL: "form-4", EVAL_MQ_K: "5", EVAL_MQ_LIMIT: "20", EVAL_MQ_RERANK: "0" })
    ).toEqual({ e2e: true, fixtures: false, offline: false, tool: "form-4", k: 5, limit: 20, rerank: false, judge: false });
    expect(parseManualQuestionEvalEnv({ EVAL_MQ_FIXTURES: "1", EVAL_MQ_OFFLINE: "true" })).toMatchObject({ offline: true, rerank: false });
    expect(() => parseManualQuestionEvalEnv({ EVAL_MQ_OFFLINE: "1" })).toThrow(/EVAL_MQ_FIXTURES/);
    expect(() => parseManualQuestionEvalEnv({ EVAL_MQ_FIXTURES: "1", EVAL_MQ_OFFLINE: "1", EVAL_MQ_E2E: "1" })).toThrow(/offline/);
    expect(() => parseManualQuestionEvalEnv({ EVAL_MQ_K: "50" })).toThrow(/EVAL_MQ_K/);
    expect(() => parseManualQuestionEvalEnv({ EVAL_MQ_TOOL: "Form 4" })).toThrow(/slug/);
    expect(recallKs(8)).toEqual([1, 3, 8]);
    expect(recallKs(1)).toEqual([1]);
  });
});

describe("assessAnswer", () => {
  const fixture = buildFixture();
  const form4 = fixture.tools.find((t) => t.slug === "form-4")!;
  const question: StoredEvalQuestion = {
    id: "q1",
    documentId: "doc-form4",
    documentTitle: "Form 4 Manual",
    toolId: form4.id,
    toolSlug: "form-4",
    toolName: form4.name,
    question: "How do I swap out the resin tank?",
    expectedPages: [42],
    chunkOrdinal: 5,
    sectionPath: ["Maintenance"],
    expectedAnswer: "Lift it out.",
    model: "fixture",
    public: true,
  };
  const passage = (url: string, toolId = form4.id, tool = form4.name) => ({
    name: "search_manual",
    output: { status: "ok", passages: [{ ref: "3f2a9c10-41", citation: "Form 4 Manual, p. 41", url, text: "…", toolId, tool }] },
  });
  const run = (page: number | null, documentId = "doc-form4", text = "See [p. 41](#cite-3f2a9c10-41)."): AnswerRun => ({
    text,
    toolCalls: [passage("https://blob.test/form-4.pdf#page=41")],
    usageEvents: [{ kind: "tool_asked", manualDocumentId: null, page: null }, { kind: "manual_cited", manualDocumentId: documentId, page }],
  });

  it("passes an answer citing the document a page before the expected one", () => {
    expect(assessAnswer(question, run(41), fixture).map((c) => [c.kind, c.ok])).toEqual([
      ["cites_document", true],
      ["cites_expected_page", true],
      ["cites_only_tool", true],
    ]);
  });

  it("fails another page, another document, no citation, and another machine's document", () => {
    const farPage = assessAnswer(question, run(30), fixture);
    expect(farPage.find((c) => c.kind === "cites_expected_page")).toMatchObject({ ok: false, detail: "expected p. 42 (±1); cited p. 30" });
    expect(assessAnswer(question, run(42, "doc-other"), fixture)[0]).toMatchObject({ ok: false, detail: expect.stringContaining("not Form 4 Manual") });
    expect(assessAnswer(question, { text: "No idea.", toolCalls: [], usageEvents: [] }, fixture)[0]).toMatchObject({ ok: false, detail: "cites no manual page" });
    const other = { ...run(42), toolCalls: [passage("https://blob.test/form-4.pdf#page=41", "another-tool", "Prusa i3 MK3S+")] };
    expect(assessAnswer(question, other, fixture)[2]).toMatchObject({ kind: "cites_only_tool", ok: false });
  });
});

describe("runManualQuestionEval on the fixtures, offline", () => {
  it("finds every fixture question's page in the top k, judges the stubbed answers, and writes one report", async () => {
    const target = fakeEmbeddingTarget();
    await seedEvalManual({ target });
    expect(await seedEvalManualQuestions()).toBe(FIXTURE_QUESTIONS.length);
    const options = parseManualQuestionEvalEnv({ EVAL_MQ_FIXTURES: "1", EVAL_MQ_OFFLINE: "1" });
    const reportDir = mkdtempSync(join(tmpdir(), "manual-questions-report-"));
    const asked: string[] = [];

    // Retrieval only, as the offline run does.
    const { report, file } = await runManualQuestionEval(options, {
      db: await getDb(),
      fixture: buildFixture(await getCatalogTools()),
      target,
      reportDir,
      now: () => new Date("2026-10-06T12:00:00Z"),
    });
    expect(report.questions).toBe(FIXTURE_QUESTIONS.length);
    const all = report.retrieval.recall.at(-1)!;
    expect(all).toMatchObject({ group: "all", questions: FIXTURE_QUESTIONS.length, missed: 0, wrongPage: 0 });
    expect(all.recall[8]).toBe(1);
    expect(report.retrieval.recall.map((row) => row.group)).toEqual(["form-4", "all"]);
    expect(report.endToEnd).toBeNull();
    expect(file).toBe(join(reportDir, "2026-10-06T12-00-00-000Z.json"));
    expect(JSON.parse(readFileSync(file!, "utf8")).retrieval.results).toHaveLength(FIXTURE_QUESTIONS.length);
    expect(formatManualQuestionReport(report)).toMatch(/form-4\s+7\s+[\d.]+\s+[\d.]+\s+1\.00\s+0\s+0/);

    // End to end with a stubbed chat: an answer citing the expected page passes, one citing nothing fails.
    const e2e = await runManualQuestionEval(
      { ...options, offline: false, e2e: true, tool: "form-4", limit: 2 },
      {
        db: await getDb(),
        fixture: buildFixture(await getCatalogTools()),
        target,
        answer: async (q) => {
          asked.push(q.question);
          return asked.length === 1
            ? { text: "Answer.", toolCalls: [], usageEvents: [{ kind: "manual_cited", manualDocumentId: q.documentId, page: q.expectedPages[0] }] }
            : { text: "I don't know.", toolCalls: [], usageEvents: [] };
        },
      }
    );
    expect(asked).toHaveLength(2);
    expect(e2e.report.endToEnd?.totals).toMatchObject({ asked: 2, passed: 1, failed: 1, skipped: 0, judged: null });
    expect(e2e.file).toBeNull();
    expect(formatManualQuestionReport(e2e.report)).toMatch(/End to end .* 1\/2 passed/);

    // Judged: a verdict per answer, counted beside the page checks; a judge that fails is "no verdict", not a crash.
    let call = 0;
    const judged = await runManualQuestionEval(
      { ...options, offline: false, e2e: true, judge: true, tool: "form-4", limit: 3 },
      {
        db: await getDb(),
        fixture: buildFixture(await getCatalogTools()),
        target,
        answer: async (q) => ({ text: `About ${q.question}`, toolCalls: [], usageEvents: [] }),
        judge: async (q, answer) => {
          expect(answer).toBe(`About ${q.question}`);
          call += 1;
          if (call === 3) throw new Error("no verdict in the reply");
          return { verdict: call === 1 ? "correct" : "declined", reason: "stub", cost: 0.004 };
        },
      }
    );
    expect(judged.report.endToEnd?.totals.judged).toEqual({ correct: 1, partial: 0, wrong: 0, declined: 1, error: 1 });
    expect(judged.report.endToEnd?.totals.judgeCost).toBeCloseTo(0.008, 10);
    expect(formatManualQuestionReport(judged.report)).toMatch(/judged against the manual's answer: correct 1\/3 · partial 0 · wrong 0 · declined 1 · no verdict 1/);
  });

  it("says how to write questions when there are none", async () => {
    const options = parseManualQuestionEvalEnv({ EVAL_MQ_TOOL: "trotec-speedy-400" });
    await expect(runManualQuestionEval(options, { db: await getDb(), fixture: buildFixture() })).rejects.toThrow(/manuals:eval-questions -- --apply --tool trotec-speedy-400/);
  });
});
