// @vitest-environment node
import { formatRecallTable, passageHits, recallByTool, type RetrievalResult } from "./eval-retrieval";

/**
 * The retrieval check's arithmetic (manual text spec amendment 2026-10-07):
 * a hit is the question's document on an expected page; recall@k per machine
 * and overall. `runRetrievalCheck` itself runs in `evals/manual-questions.test.ts`.
 */

const result = (toolSlug: string, rank: number | null, documentRank: number | null = rank): RetrievalResult => ({
  questionId: `${toolSlug}-${rank}`,
  toolSlug,
  documentId: "d",
  question: "q",
  expectedPages: [4],
  rank,
  documentRank,
  returned: [],
  vectorFailed: false,
  rerankFailed: false,
  cost: null,
});

describe("passageHits", () => {
  it("is the expected document on a page the passage spans", () => {
    const question = { documentId: "d", expectedPages: [41, 42] };
    expect(passageHits({ documentId: "d", pageStart: 42, pageEnd: 43 }, question)).toBe(true);
    expect(passageHits({ documentId: "d", pageStart: 43, pageEnd: 44 }, question)).toBe(false);
    expect(passageHits({ documentId: "other", pageStart: 41, pageEnd: 41 }, question)).toBe(false);
  });
});

describe("recallByTool", () => {
  it("gives recall at each k per machine and overall, with wrong pages and misses counted", () => {
    const rows = recallByTool([result("form-4", 1), result("form-4", 5), result("trotec", null, 2), result("trotec", null, null)], [1, 3, 8]);
    expect(rows).toEqual([
      { group: "form-4", questions: 2, recall: { 1: 0.5, 3: 0.5, 8: 1 }, wrongPage: 0, missed: 0 },
      { group: "trotec", questions: 2, recall: { 1: 0, 3: 0, 8: 0 }, wrongPage: 1, missed: 1 },
      { group: "all", questions: 4, recall: { 1: 0.25, 3: 0.25, 8: 0.5 }, wrongPage: 1, missed: 1 },
    ]);
    const table = formatRecallTable(rows, [1, 3, 8]);
    expect(table.split("\n")[0]).toMatch(/^machine\s+questions\s+recall@1\s+recall@3\s+recall@8\s+wrong page\s+missed$/);
    expect(table).toMatch(/all\s+4\s+0\.25\s+0\.25\s+0\.50\s+1\s+1/);
  });
});
