import { generateText, type LanguageModel } from "ai";
import { classifyModelError, type ModelErrorKind } from "../ai/gateway-errors.ts";
import { describeGatewayCall, gatewayCallReport } from "../ai/gateway-usage.ts";
import { languageModelFor, modelIdFor, providerOptionsFor } from "../ai/models.ts";
import {
  copyQuestionsForSameText,
  loadDocumentForQuestions,
  replaceDocumentQuestions,
} from "../data/manual-eval-questions.ts";
import type { Db } from "../db/types.ts";
import {
  buildQuestionPrompt,
  chooseQuestions,
  EVAL_QUESTIONS_SYSTEM_PROMPT,
  parseQuestions,
} from "./eval-questions-model.ts";
import {
  documentTextHash,
  evalQuestionCount,
  isAskable,
  passagePages,
  pickPassages,
  questionsFor,
} from "./eval-questions-pick.ts";

/**
 * Eval questions from a manual (manual text spec amendment 2026-10-07).
 *
 * When a document's passages are built, a few questions a student could ask
 * are written from its passages by job `evalQuestions` (Opus), each tied
 * to the page its passage is on, and stored (`manual_eval_questions`). The
 * manual evals then check that `search_manual` finds that page and that the
 * assistant cites that document there, so the evals follow the lab's real
 * manuals instead of two fixtures.
 *
 * - **Once per text and model.** The questions record the digest of the
 *   document's page texts and the model that wrote them. A document whose text
 *   hashes the same, asked by the same model, is `up_to_date` (passages rebuilt
 *   for a new chunker or embedding model ask nothing, and a backfill that
 *   stopped part-way resumes); one whose text or model changed has its
 *   questions replaced. The same text on another document (one PDF on two
 *   machines), by the same model, is **copied**, with no model call.
 * - **Off switch.** `MANUAL_EVAL_QUESTIONS=0` (`evalQuestionCount`).
 * - **Outcomes are values.** A model failure is `failed`, `transient` for what
 *   a retry could fix (rate limit, a provider's bad minute, a timeout, no
 *   answer). An answer that cannot be read is `failed` and not transient. The
 *   stored text, passages and any earlier questions are never touched by a
 *   failure.
 * - **Cost** is the Gateway's figure, logged per document like the other jobs.
 *
 * Logs ids, counts, tokens and cost only. Plain Node: relative imports.
 */

export type EvalQuestionsOutcome =
  | {
      status: "written";
      documentId: string;
      questions: number;
      rejected: number;
      inputTokens: number;
      outputTokens: number;
      /** Dollars the Gateway reported; null when it reported none. */
      cost: number | null;
      model: string;
      ms: number;
    }
  | { status: "copied"; documentId: string; questions: number }
  | {
      status: "skipped";
      documentId: string;
      reason: "disabled" | "up_to_date" | "not_searchable" | "nothing_to_ask";
    }
  | {
      /** A dry run: what one model call would be asked for. Nothing called, nothing written. */
      status: "planned";
      documentId: string;
      questions: number;
      passages: number;
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
    }
  | {
      status: "failed";
      documentId: string;
      reason: "model" | "unreadable";
      kind: ModelErrorKind | "unknown" | null;
      transient: boolean;
    };

export interface EvalQuestionsOptions {
  /** Questions wanted; default `MANUAL_EVAL_QUESTIONS` (4). */
  count?: number;
  /** Write new questions even when the text has not changed (the backfill's `--force`). */
  force?: boolean;
  /** Plan and estimate; call no model and write nothing (the backfill's default). */
  dryRun?: boolean;
  /** The model; the deployment's `evalQuestions` job by default. Tests pass a stub. */
  model?: LanguageModel;
}

/**
 * Tokens a question costs in output, and the reasoning a call adds, for the
 * dry run's estimate. Measured shape, not a promise: the Gateway's reported
 * cost is the real figure.
 */
export const ESTIMATED_OUTPUT_TOKENS_PER_QUESTION = 90;
export const ESTIMATED_REASONING_TOKENS = 600;

/** Write (or keep, or copy) one document's eval questions. Throws only for the database. */
export async function generateDocumentQuestions(
  db: Db,
  documentId: string,
  options: EvalQuestionsOptions = {}
): Promise<EvalQuestionsOutcome> {
  const count = options.count ?? evalQuestionCount();
  if (count <= 0) return { status: "skipped", documentId, reason: "disabled" };
  const doc = await loadDocumentForQuestions(db, documentId);
  if (!doc) return { status: "skipped", documentId, reason: "not_searchable" };

  // Up to date is the same text asked by the same model: a model change writes
  // them again, and a run that stopped part-way resumes where it stopped.
  const modelId = options.model ? labelOf(options.model) : modelIdFor("evalQuestions");
  const sourceHash = documentTextHash(doc.pages);
  if (!options.force && doc.questionsHash === sourceHash && doc.questionsModel === modelId) {
    return { status: "skipped", documentId, reason: "up_to_date" };
  }
  if (!options.force) {
    const copied = await copyQuestionsForSameText(db, documentId, { toolId: doc.toolId, sourceHash, model: modelId, dryRun: options.dryRun });
    if (copied > 0) return { status: "copied", documentId, questions: copied };
  }

  const target = questionsFor(doc.passages.filter(isAskable).length, count);
  const offered = pickPassages(doc.passages, target);
  if (target === 0 || offered.length === 0) {
    // The text changed and has nothing to ask about: its old questions no longer hold.
    if (!options.dryRun && doc.questionCount > 0) {
      await replaceDocumentQuestions(db, documentId, { toolId: doc.toolId, sourceHash, model: "none", questions: [] });
    }
    return { status: "skipped", documentId, reason: "nothing_to_ask" };
  }

  const prompt = buildQuestionPrompt({ toolName: doc.toolName, documentTitle: doc.title, passages: offered, wanted: target });
  if (options.dryRun) {
    return {
      status: "planned",
      documentId,
      questions: target,
      passages: offered.length,
      estimatedInputTokens: Math.ceil((EVAL_QUESTIONS_SYSTEM_PROMPT.length + prompt.length) / 4),
      estimatedOutputTokens: target * ESTIMATED_OUTPUT_TOKENS_PER_QUESTION + ESTIMATED_REASONING_TOKENS,
    };
  }

  const started = Date.now();
  let result;
  try {
    result = await generateText({
      model: options.model ?? languageModelFor("evalQuestions"),
      system: EVAL_QUESTIONS_SYSTEM_PROMPT,
      prompt,
      providerOptions: providerOptionsFor("evalQuestions"),
      maxRetries: 2,
      abortSignal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    const outcome = failedOutcome(documentId, error);
    console.warn(
      `[manuals] eval questions failed: document=${documentId} kind=${outcome.kind ?? "unknown"} transient=${outcome.transient}`
    );
    return outcome;
  }

  const report = gatewayCallReport(result.providerMetadata);
  const inputTokens = result.totalUsage.inputTokens ?? 0;
  const outputTokens = result.totalUsage.outputTokens ?? 0;
  const parsed = parseQuestions(result.text, offered);
  if (parsed.questions === null) {
    console.warn(
      `[manuals] eval questions unreadable: document=${documentId} tokens=${inputTokens}/${outputTokens} ${describeGatewayCall(report)}`
    );
    return { status: "failed", documentId, reason: "unreadable", kind: null, transient: false };
  }

  const chosen = chooseQuestions(parsed.questions, target);
  await replaceDocumentQuestions(db, documentId, {
    toolId: doc.toolId,
    sourceHash,
    model: modelId,
    questions: chosen.map((q) => ({
      question: q.question,
      expectedPages: passagePages(q.passage),
      chunkOrdinal: q.passage.ordinal,
      sectionPath: q.passage.sectionPath,
      expectedAnswer: q.answer,
    })),
  });
  const ms = Date.now() - started;
  console.info(
    `[manuals] eval questions written: document=${documentId} questions=${chosen.length} rejected=${parsed.rejected.length}` +
      ` tokens=${inputTokens}/${outputTokens} ${describeGatewayCall(report)} ms=${ms}`
  );
  return {
    status: "written",
    documentId,
    questions: chosen.length,
    rejected: parsed.rejected.length,
    inputTokens,
    outputTokens,
    cost: report.cost,
    model: modelId,
    ms,
  };
}

const TRANSIENT_KINDS: readonly ModelErrorKind[] = ["rate_limited", "provider_unavailable", "timeout"];

function failedOutcome(documentId: string, error: unknown): Extract<EvalQuestionsOutcome, { status: "failed" }> {
  const classified = classifyModelError(error);
  if (!classified) {
    const text = `${(error as { name?: string })?.name ?? ""} ${(error as { message?: string })?.message ?? ""}`;
    const transient = /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timeout|abort/i.test(text);
    return { status: "failed", documentId, reason: "model", kind: "unknown", transient };
  }
  return {
    status: "failed",
    documentId,
    reason: "model",
    kind: classified.kind,
    transient: TRANSIENT_KINDS.includes(classified.kind),
  };
}

function labelOf(model: LanguageModel): string {
  return typeof model === "string" ? model : `${model.provider}/${model.modelId}`;
}
