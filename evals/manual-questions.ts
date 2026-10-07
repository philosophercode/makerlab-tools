import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { listEvalQuestions, type StoredEvalQuestion } from "@/lib/data/manual-eval-questions";
import type { Db } from "@/lib/db/types";
import type { EmbeddingTarget } from "@/lib/manuals/embed";
import {
  formatRecallTable,
  recallByTool,
  runRetrievalCheck,
  type RecallRow,
  type RetrievalResult,
} from "@/lib/manuals/eval-retrieval";
import { citesOnlyTool, type RecordedToolCall } from "./assertions";
import type { EvalFixture } from "./fixtures";

/**
 * The manual question eval's options, its end-to-end check and its report
 * (manual text spec amendment 2026-10-07). The questions come from
 * `manual_eval_questions`, written from the lab's own manuals when they were
 * indexed; `manual-questions.eval.ts` runs them.
 *
 * Two modes:
 * - **retrieval** (always): `search_manual`'s search, scoped to the question's
 *   machine, must return a passage of the question's document on an expected
 *   page within the top k (`lib/manuals/eval-retrieval.ts`). No chat model.
 * - **end to end** (`EVAL_MQ_E2E=1`, paid): the question is asked on that
 *   machine's page through the real chat pipeline, as a visitor who is not
 *   signed in, and the answer must cite that document at an expected page
 *   (plus or minus one) and cite no other machine's document
 *   ({@link assessAnswer}). A question about a private document is skipped:
 *   a visitor cannot search it.
 *
 * Pure apart from {@link writeReport}.
 */

export interface ManualQuestionEvalOptions {
  /** Run the paid end-to-end check too. */
  e2e: boolean;
  /** The eval's own fixture manuals and questions on the demo seed, not the configured database. */
  fixtures: boolean;
  /** Fixtures only: a hashed bag-of-words embedding and no reranker, so no network at all. */
  offline: boolean;
  /** One machine's slug; null for every machine. */
  tool: string | null;
  /** Passages the search returns (recall@k). */
  k: number;
  /** At most this many questions; null for all. */
  limit: number | null;
  /** Rerank as `search_manual` does. */
  rerank: boolean;
}

/** Read the options from the environment, as `npm run eval` reads `EVAL_CASES`. Throws on a bad value. */
export function parseManualQuestionEvalEnv(env: Record<string, string | undefined>): ManualQuestionEvalOptions {
  const flag = (name: string) => ["1", "true", "yes"].includes((env[name] ?? "").trim().toLowerCase());
  const whole = (name: string, fallback: number | null, min: number, max: number) => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
    return n;
  };
  const tool = env.EVAL_MQ_TOOL?.trim() || null;
  if (tool && !/^[a-z0-9][a-z0-9-]*$/.test(tool)) throw new Error(`EVAL_MQ_TOOL takes a machine's slug (e.g. form-4); "${tool}" is not one.`);
  const options: ManualQuestionEvalOptions = {
    e2e: flag("EVAL_MQ_E2E"),
    fixtures: flag("EVAL_MQ_FIXTURES"),
    offline: flag("EVAL_MQ_OFFLINE"),
    tool,
    k: whole("EVAL_MQ_K", 8, 1, 20) as number,
    limit: whole("EVAL_MQ_LIMIT", null, 1, 10_000),
    rerank: (env.EVAL_MQ_RERANK ?? "").trim() !== "0",
  };
  if (options.offline && !options.fixtures) throw new Error("EVAL_MQ_OFFLINE works only with EVAL_MQ_FIXTURES=1 (the fixtures are embedded offline).");
  if (options.offline && options.e2e) throw new Error("EVAL_MQ_E2E asks the real chat model; it cannot run offline.");
  if (options.offline) options.rerank = false;
  return options;
}

// ── End to end ──────────────────────────────────────────────────────

/** A citation the chat would record for Usage Insight: which document and page the answer linked. */
export interface CitedPage {
  kind: string;
  manualDocumentId: string | null;
  page: number | null;
}

/** What one answer produced, as the starter pipeline returns it. */
export interface AnswerRun {
  text: string;
  toolCalls: RecordedToolCall[];
  usageEvents: CitedPage[];
  usage?: { inputTokens: number; outputTokens: number; gatewayCost: number | null };
}

export interface AnswerCheck {
  kind: "cites_document" | "cites_expected_page" | "cites_only_tool";
  ok: boolean;
  detail: string;
}

/** How far from an expected page a cited page may be: a passage often starts on the page before. */
export const PAGE_TOLERANCE = 1;

/**
 * Judge one answer: it cites the question's document, at an expected page
 * (plus or minus {@link PAGE_TOLERANCE}), and cites no other machine's
 * document (`cites_only_tool`). Citations are read the way Usage Insight reads
 * them (`manual_cited`: the passages the answer linked).
 */
export function assessAnswer(question: StoredEvalQuestion, run: AnswerRun, fixture: EvalFixture): AnswerCheck[] {
  const cited = run.usageEvents.filter((event) => event.kind === "manual_cited");
  const ofDocument = cited.filter((event) => event.manualDocumentId === question.documentId);
  const low = Math.min(...question.expectedPages) - PAGE_TOLERANCE;
  const high = Math.max(...question.expectedPages) + PAGE_TOLERANCE;
  const onPage = ofDocument.filter((event) => event.page !== null && event.page >= low && event.page <= high);
  const pages = (events: CitedPage[]) => [...new Set(events.map((e) => e.page))].join(", ") || "none";
  const scoped = citesOnlyTool(run.text, run.toolCalls, fixture, question.toolSlug, [], question.toolSlug);
  return [
    {
      kind: "cites_document",
      ok: ofDocument.length > 0,
      detail: ofDocument.length > 0 ? "" : cited.length > 0 ? `cites ${cited.length} other passage(s), not ${question.documentTitle}` : "cites no manual page",
    },
    {
      kind: "cites_expected_page",
      ok: onPage.length > 0,
      detail: onPage.length > 0 ? "" : `expected p. ${question.expectedPages.join("-")} (±${PAGE_TOLERANCE}); cited p. ${pages(ofDocument)}`,
    },
    { kind: "cites_only_tool", ok: scoped.ok, detail: scoped.ok ? "" : (scoped.detail ?? "cites another machine's document") },
  ];
}

export type EndToEndStatus = "pass" | "fail" | "error" | "skipped";

export interface EndToEndResult {
  questionId: string;
  toolSlug: string;
  question: string;
  status: EndToEndStatus;
  checks: AnswerCheck[];
  /** Why it was skipped or errored. */
  note?: string;
  answer?: string;
  usage?: AnswerRun["usage"];
}

/** Ask each public question once, in turn, and judge it. A private document's question is skipped. */
export async function runEndToEnd(
  questions: readonly StoredEvalQuestion[],
  answer: (question: StoredEvalQuestion) => Promise<AnswerRun>,
  fixture: EvalFixture,
  onResult?: (result: EndToEndResult) => void
): Promise<EndToEndResult[]> {
  const results: EndToEndResult[] = [];
  for (const question of questions) {
    const base = { questionId: question.id, toolSlug: question.toolSlug, question: question.question };
    let result: EndToEndResult;
    if (!question.public) {
      result = { ...base, status: "skipped", checks: [], note: "private document: a visitor cannot search it" };
    } else {
      try {
        const run = await answer(question);
        const checks = assessAnswer(question, run, fixture);
        result = {
          ...base,
          status: checks.every((c) => c.ok) ? "pass" : "fail",
          checks,
          answer: run.text.slice(0, 2000),
          ...(run.usage ? { usage: run.usage } : {}),
        };
      } catch (error) {
        result = { ...base, status: "error", checks: [], note: error instanceof Error ? error.message.slice(0, 300) : String(error) };
      }
    }
    results.push(result);
    onResult?.(result);
  }
  return results;
}

export interface EndToEndTotals {
  asked: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  /** Per check kind: how many asked answers passed it. */
  byCheck: Record<AnswerCheck["kind"], number>;
  inputTokens: number;
  outputTokens: number;
  /** Gateway-reported dollars for the chat turns; null when none was reported. */
  cost: number | null;
}

export function endToEndTotals(results: readonly EndToEndResult[]): EndToEndTotals {
  const asked = results.filter((r) => r.status === "pass" || r.status === "fail");
  const byCheck = { cites_document: 0, cites_expected_page: 0, cites_only_tool: 0 };
  for (const r of asked) for (const c of r.checks) if (c.ok) byCheck[c.kind] += 1;
  let cost: number | null = null;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const r of results) {
    inputTokens += r.usage?.inputTokens ?? 0;
    outputTokens += r.usage?.outputTokens ?? 0;
    if (r.usage?.gatewayCost != null) cost = (cost ?? 0) + r.usage.gatewayCost;
  }
  return {
    asked: asked.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    errored: results.filter((r) => r.status === "error").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    byCheck,
    inputTokens,
    outputTokens,
    cost,
  };
}

// ── Report ──────────────────────────────────────────────────────────

/** recall@1, @3 and @k, in order, without repeats. */
export function recallKs(k: number): number[] {
  return [...new Set([1, 3, k])].filter((n) => n <= k).sort((a, b) => a - b);
}

export interface ManualQuestionReport {
  startedAt: string;
  source: "fixtures" | "database";
  options: ManualQuestionEvalOptions;
  questions: number;
  retrieval: { ks: number[]; recall: RecallRow[]; results: RetrievalResult[]; cost: number | null };
  endToEnd: { totals: EndToEndTotals; results: EndToEndResult[] } | null;
}

/** The run in words: the recall table, then the end-to-end totals and every miss. */
export function formatManualQuestionReport(report: ManualQuestionReport): string {
  const lines = [
    "",
    `Manual question eval — ${report.questions} question(s) from ${report.source === "fixtures" ? "the eval fixtures" : "the database"}`,
    "",
    `Retrieval (search_manual's search, scoped to the machine, top ${report.options.k}${report.options.rerank ? ", reranked" : ""}):`,
    formatRecallTable(report.retrieval.recall, report.retrieval.ks),
  ];
  const misses = report.retrieval.results.filter((r) => r.rank === null);
  if (misses.length > 0) {
    lines.push("", "Not found in the top k:");
    for (const r of misses.slice(0, 40)) {
      lines.push(`  ${r.toolSlug}: "${r.question}" (expected p. ${r.expectedPages.join("-")}; ${r.documentRank ? `document at rank ${r.documentRank}, other page` : "document not returned"})`);
    }
    if (misses.length > 40) lines.push(`  … and ${misses.length - 40} more (see the report file)`);
  }
  if (report.retrieval.cost !== null && !report.options.offline) lines.push("", `Search cost (embeddings and rerank): $${report.retrieval.cost.toFixed(4)}`);
  if (report.endToEnd) {
    const t = report.endToEnd.totals;
    lines.push(
      "",
      `End to end (asked on the machine's page, as a visitor): ${t.passed}/${t.asked} passed · ${t.failed} failed · ${t.errored} errored · ${t.skipped} skipped (private)`,
      `  cites the document ${t.byCheck.cites_document}/${t.asked} · at the expected page ±${PAGE_TOLERANCE} ${t.byCheck.cites_expected_page}/${t.asked} · only its machine ${t.byCheck.cites_only_tool}/${t.asked}`,
      `  tokens ~${t.inputTokens} in / ~${t.outputTokens} out${t.cost !== null ? ` · Gateway cost $${t.cost.toFixed(4)}` : ""}`
    );
    for (const r of report.endToEnd.results.filter((r) => r.status === "fail" || r.status === "error")) {
      lines.push(`  ${r.status.toUpperCase()} ${r.toolSlug}: "${r.question}"`);
      if (r.note) lines.push(`      ${r.note}`);
      for (const c of r.checks.filter((c) => !c.ok)) lines.push(`      x ${c.kind}: ${c.detail}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** Write the run's report as JSON in `dir`, one file per run; returns its path. */
export function writeReport(report: ManualQuestionReport, dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${report.startedAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

// ── The run ─────────────────────────────────────────────────────────

export interface ManualQuestionEvalDeps {
  db: Db;
  /** The catalogue as the assertions see it (`buildFixture(await getCatalogTools())`). */
  fixture: EvalFixture;
  /** Ask one question on its machine's page; required when `options.e2e`. */
  answer?: (question: StoredEvalQuestion) => Promise<AnswerRun>;
  /** The query embedding model; job `embed` by default (offline: a fake). */
  target?: EmbeddingTarget;
  /** Where the report file goes; none written when absent. */
  reportDir?: string;
  log?: (line: string) => void;
  now?: () => Date;
}

/**
 * Load the questions, run the retrieval check, then (when asked) the end to
 * end check, and write one report file. Returns the report and its path.
 */
export async function runManualQuestionEval(
  options: ManualQuestionEvalOptions,
  deps: ManualQuestionEvalDeps
): Promise<{ report: ManualQuestionReport; file: string | null }> {
  const log = deps.log ?? (() => {});
  const startedAt = (deps.now ?? (() => new Date()))().toISOString();
  const questions = await listEvalQuestions(deps.db, { toolSlug: options.tool, limit: options.limit });
  if (questions.length === 0) {
    throw new Error(
      options.tool
        ? `No eval questions for ${options.tool}. Write them with npm run manuals:eval-questions -- --apply --tool ${options.tool}.`
        : "No eval questions. Write them with npm run manuals:eval-questions -- --apply (or run on the fixtures: EVAL_MQ_FIXTURES=1)."
    );
  }
  log(`${questions.length} question(s) on ${new Set(questions.map((q) => q.toolSlug)).size} machine(s). Retrieval…`);
  const results = await runRetrievalCheck(deps.db, questions, {
    k: options.k,
    rerank: options.rerank,
    ...(deps.target ? { target: deps.target } : {}),
  });
  const ks = recallKs(options.k);
  const searchCost = results.reduce<number | null>((sum, r) => (r.cost === null ? sum : (sum ?? 0) + r.cost), null);

  let endToEnd: ManualQuestionReport["endToEnd"] = null;
  if (options.e2e) {
    if (!deps.answer) throw new Error("the end-to-end check needs an answer function");
    log(`End to end: asking ${questions.filter((q) => q.public).length} question(s) through the chat…`);
    const e2e = await runEndToEnd(questions, deps.answer, deps.fixture, (r) =>
      log(`  ${r.status.toUpperCase().padEnd(7)} ${r.toolSlug}: ${r.question}`)
    );
    endToEnd = { totals: endToEndTotals(e2e), results: e2e };
  }

  const report: ManualQuestionReport = {
    startedAt,
    source: options.fixtures ? "fixtures" : "database",
    options,
    questions: questions.length,
    retrieval: { ks, recall: recallByTool(results, ks), results, cost: searchCost },
    endToEnd,
  };
  const file = deps.reportDir ? writeReport(report, deps.reportDir) : null;
  return { report, file };
}
