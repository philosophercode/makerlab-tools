import { updateTool } from "../data/tools.ts";
import {
  deleteStarterAnswersExcept,
  loadGeneralHashInputs,
  loadToolHashInputs,
  upsertStarterAnswer,
  type StarterTool,
  type StoredGrade,
} from "../data/starter-answers.ts";
import type { Db } from "../db/types.ts";
import type { StarterAnswerRun } from "./answer.ts";
import { STARTER_LOCALE, starterHashContext } from "./cache.ts";
import { describeCoverage, type StarterToolContext } from "./context.ts";
import type { GradeInput, StarterGrade } from "./grade.ts";
import { canonicalInputs, starterSourceHash, type StarterHashInputs } from "./hash.ts";
import { refineChips, type Evaluated, type WriteQuestionsInput, type WriteQuestionsResult } from "./refine.ts";

/**
 * `npm run starters:refresh` for one chip set (starter answers): ask every
 * chip's question through the chat (`answer.ts`), grade it (`grade.ts`),
 * replace the weak ones (`refine.ts`), and — with `apply` — write the tool's
 * new questions through `updateTool` (revision-checked, like the backfill)
 * and store every answer with its grade and source hash. A dry run does all
 * the model work and writes nothing.
 *
 * The model calls are passed in ({@link RefreshDeps}), so the orchestration
 * is tested with no model; `scripts/starters/refresh.task.ts` wires the real
 * ones.
 */

export interface RefreshDeps {
  answer: (input: { question: string; toolId: string | null }) => Promise<StarterAnswerRun>;
  grade: (input: GradeInput) => Promise<StarterGrade>;
  write: (input: WriteQuestionsInput) => Promise<WriteQuestionsResult>;
}

export interface CallUsage {
  inputTokens: number;
  outputTokens: number;
  /** Summed Gateway-reported cost; null when no call reported one. */
  gatewayCost: number | null;
}

export interface ChipReport {
  question: string;
  round: number;
  accepted: boolean;
  score: number;
  failures: string[];
  reasons: string[];
  citations: number;
  answerPreview: string;
}

export type ToolWriteStatus =
  | "questions_updated"
  | "questions_unchanged"
  | "would_update"
  | "would_keep"
  | "skipped_conflict"
  | "skipped_changed_during_run"
  | "failed";

export interface ChipSetReport {
  toolId: string | null;
  slug: string | null;
  name: string;
  before: string[];
  after: string[];
  changed: boolean;
  rounds: number;
  chips: ChipReport[];
  /** Answers written (accepted and served) with `apply`, or that would be. */
  cached: number;
  write: ToolWriteStatus;
  error?: string;
  usage: { answer: CallUsage; grade: CallUsage; write: CallUsage };
  /** A readable answer or two, for the summary. */
  samples: { question: string; text: string }[];
}

interface Made {
  run: StarterAnswerRun;
  grade: StarterGrade;
}

/** Tries per question when the miss is the run's, not the question's (`StarterGrade.retryable`). */
export const ANSWER_ATTEMPTS = 2;

const zero = (): CallUsage => ({ inputTokens: 0, outputTokens: 0, gatewayCost: null });

function add(total: CallUsage, usage: { inputTokens: number; outputTokens: number; gatewayCost: number | null }): void {
  total.inputTokens += usage.inputTokens;
  total.outputTokens += usage.outputTokens;
  if (usage.gatewayCost !== null) total.gatewayCost = (total.gatewayCost ?? 0) + usage.gatewayCost;
}

/** A grade for a question whose run threw: failed, not disqualified (it may be retried next time). */
function failedGrade(error: unknown): StarterGrade {
  const message = error instanceof Error ? error.message.replace(/\x1b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 200) : "failed";
  return {
    accepted: false,
    score: 0,
    reasons: [],
    failures: [`the run failed: ${message}`],
    judge: null,
    checks: { stubbedCalls: [], unverifiedCitations: [], resourceLinks: [], mapLinks: [], citedPassages: 0, liveStateCalls: [], catalogCalls: [], gap: null, empty: true },
    disqualified: false,
    errored: true,
    retryable: false,
    usage: { inputTokens: 0, outputTokens: 0, gatewayCost: null },
  };
}

/** What a stored row keeps of a grade. */
export function storedGrade(grade: StarterGrade, round: number): StoredGrade {
  return {
    score: grade.score,
    reasons: grade.reasons,
    accepted: grade.accepted,
    failures: grade.failures,
    judge: grade.judge,
    checks: grade.checks,
    round,
  };
}

export interface RefreshChipSetInput {
  db: Db;
  deps: RefreshDeps;
  apply: boolean;
  /** A tool's chip set, or null for the general chips. */
  tool: (StarterTool & { context: StarterToolContext }) | null;
  /** The general chips' current texts and their prompt material (`tool` null only). */
  general?: { questions: string[]; record: string; coverage: string; note: string };
  maxRounds?: number;
  log?: (line: string) => void;
}

export async function refreshChipSet(input: RefreshChipSetInput): Promise<ChipSetReport> {
  const { db, deps, apply, tool } = input;
  const log = input.log ?? (() => {});
  const originals = tool ? tool.starterQuestions : (input.general?.questions ?? []);
  const record = tool ? tool.context.record : (input.general?.record ?? "");
  const coverage = tool ? describeCoverage(tool.context.manuals) : (input.general?.coverage ?? "");
  const toolId = tool?.id ?? null;
  const usage = { answer: zero(), grade: zero(), write: zero() };
  const made = new Map<string, Made>();

  // What the answers will rest on, read before the first one is made: if it
  // moves while they are being made, nothing is cached (they may be stale).
  const inputsBefore = await hashInputs(db, toolId);

  const outcome = await refineChips<StarterGrade>(
    originals,
    {
      evaluate: async (question) => {
        // A miss that is the run's rather than the question's — a citation
        // that is not a returned passage, a judge that could not be read — is
        // asked once more before the question is held against.
        let entry: Made | null = null;
        for (let attempt = 0; attempt < ANSWER_ATTEMPTS && !(entry && (entry.grade.accepted || !entry.grade.retryable)); attempt += 1) {
          const run = await deps.answer({ question, toolId });
          add(usage.answer, { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens, gatewayCost: run.usage.gatewayCost });
          const grade = await deps.grade({ question, toolName: tool?.name ?? null, record, run });
          add(usage.grade, grade.usage);
          entry = { run, grade };
        }
        const { grade } = entry!;
        made.set(question, entry!);
        log(`    ${grade.accepted ? "✓" : "✗"} ${question} — score ${grade.score}${grade.failures.length ? ` (${grade.failures.join("; ")})` : ""}`);
        return grade;
      },
      propose: async ({ need, kept, rejected }) => {
        const written = await deps.write({
          toolName: tool?.name ?? null,
          record,
          coverage,
          need,
          kept,
          rejected: rejected.map((r) => ({ question: r.question, failures: [...r.grade.failures, ...r.grade.reasons] })),
          ...(input.general ? { note: input.general.note } : {}),
        });
        add(usage.write, written.usage);
        log(`    → proposed: ${written.questions.join(" | ") || "(none)"}`);
        return written.questions;
      },
      failedGrade,
    },
    { maxRounds: input.maxRounds }
  );

  const chips: ChipReport[] = outcome.evaluated.map((e: Evaluated<StarterGrade>) => ({
    question: e.question,
    round: e.round,
    accepted: e.grade.accepted,
    score: e.grade.score,
    failures: e.grade.failures,
    reasons: e.grade.reasons,
    citations: e.grade.checks.citedPassages,
    answerPreview: (made.get(e.question)?.run.text ?? "").slice(0, 400),
  }));
  // A general chip set's text lives in the translated messages, not in the
  // database: its replacements are proposals, so every accepted answer is kept
  // (an adopted proposal is then already cached) beside the current texts.
  const finalQuestions = tool ? outcome.questions : originals;
  const cacheable = tool
    ? outcome.questions.filter((q) => made.has(q))
    : outcome.evaluated.filter((e) => e.round === 0 || e.grade.accepted).map((e) => e.question);
  const accepted = cacheable.filter((q) => made.get(q)?.grade.accepted);
  const samples = accepted.slice(0, 2).map((question) => ({ question, text: made.get(question)!.run.text }));

  const report: ChipSetReport = {
    toolId,
    slug: tool?.slug ?? null,
    name: tool?.name ?? "General chips",
    before: [...originals],
    after: tool ? outcome.questions : outcome.questions,
    changed: outcome.changed,
    rounds: outcome.rounds,
    chips,
    cached: accepted.length,
    write: apply ? "questions_unchanged" : outcome.changed && tool ? "would_update" : "would_keep",
    usage,
    samples,
  };
  if (!apply) return report;

  // Nothing moved while the answers were made?
  const inputsNow = await hashInputs(db, toolId);
  if (!inputsBefore || !inputsNow || canonicalInputs(inputsNow, CANON) !== canonicalInputs(inputsBefore, CANON)) {
    report.write = "skipped_changed_during_run";
    report.cached = 0;
    return report;
  }

  if (tool && outcome.changed && inputsBefore.kind === "tool") {
    const written = await updateTool(tool.id, { starterQuestions: finalQuestions }, inputsBefore.revision, { db, actorUserId: null });
    if (!written.ok) {
      report.write = written.reason === "conflict" ? "skipped_conflict" : "failed";
      report.error = written.reason;
      report.cached = 0;
      return report;
    }
    report.write = "questions_updated";
  }

  // Hashed after the questions were written: the tool's revision is part of it.
  const inputs = await hashInputs(db, toolId);
  if (!inputs) {
    report.write = "failed";
    report.error = "the tool disappeared";
    report.cached = 0;
    return report;
  }
  for (const question of cacheable) {
    const entry = made.get(question);
    if (!entry) continue;
    const round = outcome.evaluated.find((e) => e.question === question)?.round ?? 0;
    await upsertStarterAnswer(db, {
      toolId,
      locale: STARTER_LOCALE,
      question,
      message: entry.run.message,
      model: entry.run.model,
      accepted: entry.grade.accepted,
      grade: storedGrade(entry.grade, round),
      usageEvents: entry.run.usageEvents,
      sourceHash: starterSourceHash(inputs, starterHashContext(question)),
    });
  }
  await deleteStarterAnswersExcept(db, { toolId, locale: STARTER_LOCALE }, cacheable);
  return report;
}

/** A fixed context for comparing inputs before and after (the question and model do not move). */
const CANON = { question: "", locale: STARTER_LOCALE, model: "", promptKey: "" };

async function hashInputs(db: Db, toolId: string | null): Promise<StarterHashInputs | null> {
  if (toolId === null) return loadGeneralHashInputs(db);
  return (await loadToolHashInputs(db, [toolId])).get(toolId) ?? null;
}

// ── Totals and cost ─────────────────────────────────────────────────

/** Luna's Gateway list prices, USD per million tokens (as the starter-question backfill). */
export const LUNA_PRICE = { inputPerM: 0.1, outputPerM: 0.5 } as const;

export function listPriceUsd(usage: Pick<CallUsage, "inputTokens" | "outputTokens">): number {
  return (usage.inputTokens * LUNA_PRICE.inputPerM + usage.outputTokens * LUNA_PRICE.outputPerM) / 1_000_000;
}

export function totalUsage(reports: readonly ChipSetReport[]): { answer: CallUsage; grade: CallUsage; write: CallUsage; all: CallUsage } {
  const totals = { answer: zero(), grade: zero(), write: zero(), all: zero() };
  for (const report of reports) {
    for (const key of ["answer", "grade", "write"] as const) {
      add(totals[key], report.usage[key]);
      add(totals.all, report.usage[key]);
    }
  }
  return totals;
}

/**
 * A pre-run estimate: every chip asked once, a third of them replaced once,
 * at {@link ESTIMATED_ANSWER_USD} an answer plus a grade — Luna's list
 * price for a chat turn with a `search_manual` call or two (~30k input
 * tokens, the catalogue listing being most of them), measured on the local
 * run of 2026-09-29. The Gateway-reported cost came to about a third of that
 * (prompt caching), so this is an upper bound.
 */
export const ESTIMATED_ANSWER_USD = 0.003;
export const ESTIMATED_GRADE_USD = 0.0003;

export function estimateUsd(chips: number): number {
  const asked = chips * (4 / 3);
  return asked * (ESTIMATED_ANSWER_USD + ESTIMATED_GRADE_USD);
}
