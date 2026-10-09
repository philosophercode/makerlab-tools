/**
 * Backfill eval questions for manuals already indexed (manual text spec
 * amendment 2026-10-07):
 *
 *   npm run manuals:eval-questions -- [--apply] [--tool <slug>] [--limit N] [--force]
 *
 * New and changed manuals get their questions in the archive workflow, right
 * after their passages are built (`evalQuestionsStep`). Manuals indexed before
 * that have none; this writes them.
 *
 * - **A dry run by default.** It lists the searchable manuals that need
 *   questions, says how many each would get, and prints the estimated cost at
 *   the job's model's list price (`src/lib/ai/list-prices.ts`). It calls no
 *   model and writes nothing. `--apply` calls job `evalQuestions` (Opus) once
 *   per manual and stores the questions; each line and the summary print the
 *   Gateway-reported cost.
 * - **Resumable.** Each manual is stored as it finishes. A manual already
 *   asked by the same model about the same text is skipped, so after a failure
 *   or an interrupted run, the same command picks up where it stopped.
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first: the
 *   local database is single-process).
 * - **Which manuals:** every ready, searchable current PDF of a machine that
 *   is not archived. `--tool` takes one machine's slug. A manual whose text
 *   and model are unchanged since its questions were written is skipped; the
 *   same text already asked about on another machine is copied, at no cost.
 *   `--force` writes new questions for every one.
 * - `MANUAL_EVAL_QUESTIONS` sets how many per manual (default 4, `0` is off).
 *
 * Output: one line per manual (machine, document id, what happened, tokens,
 * cost), then totals.
 */
import { fileURLToPath } from "node:url";
import { estimateUsd } from "../src/lib/ai/list-prices.ts";
import { listDocumentsForQuestions, type DocumentQuestionTarget } from "../src/lib/data/manual-eval-questions.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import type { Db } from "../src/lib/db/types.ts";
import type { EvalQuestionsOutcome } from "../src/lib/manuals/eval-questions.ts";
import type { LanguageModel } from "ai";

// ── Arguments ───────────────────────────────────────────────────────

export interface EvalQuestionsBackfillOptions {
  apply: boolean;
  force: boolean;
  /** One machine's slug; null for every machine. */
  tool: string | null;
  limit: number | null;
}

export const USAGE = "Usage: npm run manuals:eval-questions -- [--apply] [--tool <slug>] [--limit N] [--force]";

export function parseArgs(argv: readonly string[]): EvalQuestionsBackfillOptions {
  const options: EvalQuestionsBackfillOptions = { apply: false, force: false, tool: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    const value = () => {
      const next = inline ?? argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value.`);
      return next;
    };
    if (flag === "--apply") options.apply = true;
    else if (flag === "--dry-run") options.apply = false;
    else if (flag === "--force") options.force = true;
    else if (flag === "--tool") {
      const slug = value().trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`--tool takes a machine's slug (e.g. form-4); "${slug}" is not one.`);
      options.tool = slug;
    } else if (flag === "--limit") {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 1) throw new Error("--limit must be a whole number of at least 1.");
      options.limit = n;
    } else {
      throw new Error(`Unknown argument ${arg}.`);
    }
  }
  return options;
}

// ── The run ─────────────────────────────────────────────────────────

export interface EvalQuestionsBackfillReport {
  documents: number;
  written: number;
  copied: number;
  planned: number;
  upToDate: number;
  nothingToAsk: number;
  failed: number;
  questions: number;
  inputTokens: number;
  outputTokens: number;
  /** Gateway-reported dollars (`--apply`); null when none was reported. */
  cost: number | null;
  /** The model the estimate is priced at: the job's. */
  model: string;
  /** The dry run's estimate at `model`'s list price; null when it has none. */
  estimatedUsd: number | null;
  ms: number;
}

export interface RunEvalQuestionsBackfillInput {
  db: Db;
  documents: readonly DocumentQuestionTarget[];
  apply: boolean;
  force?: boolean;
  /** The model; the deployment's `evalQuestions` job by default. Tests pass a stub. */
  model?: LanguageModel;
  log?: (line: string) => void;
}

/** One manual at a time, each reported as it finishes. A failure is counted and the run goes on. */
export async function runEvalQuestionsBackfill(input: RunEvalQuestionsBackfillInput): Promise<EvalQuestionsBackfillReport> {
  const { generateDocumentQuestions } = await import("../src/lib/manuals/eval-questions.ts");
  const { modelIdFor } = await import("../src/lib/ai/models.ts");
  const log = input.log ?? (() => {});
  const started = Date.now();
  const report: EvalQuestionsBackfillReport = {
    documents: input.documents.length,
    written: 0,
    copied: 0,
    planned: 0,
    upToDate: 0,
    nothingToAsk: 0,
    failed: 0,
    questions: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    model: modelIdFor("evalQuestions"),
    estimatedUsd: null,
    ms: 0,
  };
  for (const [n, doc] of input.documents.entries()) {
    const prefix = `[${n + 1}/${input.documents.length}] ${doc.toolSlug ?? "(no machine)"} · document ${doc.documentId}:`;
    let outcome: EvalQuestionsOutcome;
    try {
      outcome = await generateDocumentQuestions(input.db, doc.documentId, {
        dryRun: !input.apply,
        force: input.force,
        model: input.model,
      });
    } catch (error) {
      report.failed += 1;
      log(`${prefix} error ${error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "unknown"}`);
      continue;
    }
    log(`${prefix} ${describeOutcome(outcome)}`);
    switch (outcome.status) {
      case "written":
        report.written += 1;
        report.questions += outcome.questions;
        report.inputTokens += outcome.inputTokens;
        report.outputTokens += outcome.outputTokens;
        if (outcome.cost !== null) report.cost = (report.cost ?? 0) + outcome.cost;
        break;
      case "copied":
        report.copied += 1;
        report.questions += outcome.questions;
        break;
      case "planned":
        report.planned += 1;
        report.questions += outcome.questions;
        report.inputTokens += outcome.estimatedInputTokens;
        report.outputTokens += outcome.estimatedOutputTokens;
        break;
      case "skipped":
        if (outcome.reason === "nothing_to_ask") report.nothingToAsk += 1;
        else report.upToDate += 1;
        break;
      case "failed":
        report.failed += 1;
        break;
    }
  }
  report.estimatedUsd = estimateUsd(report.model, report.inputTokens, report.outputTokens);
  report.ms = Date.now() - started;
  return report;
}

export function describeOutcome(outcome: EvalQuestionsOutcome): string {
  switch (outcome.status) {
    case "written":
      return (
        `${outcome.questions} question(s) written (${outcome.rejected} rejected), ${outcome.inputTokens}/${outcome.outputTokens} tokens, ` +
        `${outcome.cost === null ? "cost not reported" : `cost $${outcome.cost.toFixed(5)}`}, ${(outcome.ms / 1000).toFixed(1)}s`
      );
    case "copied":
      return `${outcome.questions} question(s) copied from the same text on another machine (no model call)`;
    case "planned":
      return (
        `would ask for ${outcome.questions} question(s) from ${outcome.passages} passages, ` +
        `~${outcome.estimatedInputTokens}/${outcome.estimatedOutputTokens} tokens`
      );
    case "skipped":
      return `skipped (${outcome.reason.replace(/_/g, " ")})`;
    case "failed":
      return `failed (${outcome.reason}${outcome.kind ? `: ${outcome.kind}` : ""}${outcome.transient ? ", transient" : ""})`;
  }
}

export function summarise(report: EvalQuestionsBackfillReport, apply: boolean): string {
  const rest =
    `${report.upToDate} up to date, ${report.nothingToAsk} with nothing to ask` +
    `${report.copied ? `, ${report.copied} copied` : ""}${report.failed ? `, ${report.failed} failed` : ""}`;
  if (!apply) {
    return (
      `Dry run: ${report.planned} manual(s) would get ${report.questions} question(s) (${rest}). ` +
      `About ${report.inputTokens} input and ${report.outputTokens} output tokens: ${priced(report)}. ` +
      `Run again with --apply to write them.`
    );
  }
  return (
    `Wrote ${report.questions} question(s) for ${report.written + report.copied} manual(s) (${rest}). ` +
    `${report.inputTokens}/${report.outputTokens} tokens, ` +
    `${report.cost === null ? "cost not reported" : `Gateway cost $${report.cost.toFixed(4)}`} in ${(report.ms / 1000).toFixed(1)}s.` +
    (report.failed ? ` Run the same command again to retry the ${report.failed} that failed; the rest are skipped.` : "")
  );
}

/** The estimate, at the model's list price, for a summary line. */
export function priced(report: { model: string; estimatedUsd: number | null }): string {
  return report.estimatedUsd === null
    ? `no list price for ${report.model} to estimate from`
    : `~$${report.estimatedUsd.toFixed(4)} at ${report.model}'s list price`;
}

// ── The command ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  let options: EvalQuestionsBackfillOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const { evalQuestionCount } = await import("../src/lib/manuals/eval-questions-pick.ts");
  const count = evalQuestionCount();
  if (count === 0) {
    console.log("MANUAL_EVAL_QUESTIONS=0: eval question generation is off. Nothing to do.");
    return;
  }
  const { modelIdFor } = await import("../src/lib/ai/models.ts");
  const model = modelIdFor("evalQuestions");
  const { describeImportTarget, NoImportTargetError, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  let target;
  try {
    target = resolveImportTarget();
  } catch (error) {
    if (!(error instanceof NoImportTargetError)) throw error;
    // Even the dry run reads the real manuals: there is no in-memory rehearsal here.
    console.error("No database to read. Set DATABASE_URL (Neon) or PGLITE_DATA_DIR (a local database, e.g. .pglite-data).");
    process.exitCode = 1;
    return;
  }
  console.log(`Target: ${describeImportTarget(target)}${options.apply ? "" : " — dry run, no model call, nothing is written"}`);
  console.log(`Questions: up to ${count} a manual, job evalQuestions (${model})${options.force ? ", every manual again (--force)" : ""}`);

  let opened;
  try {
    opened = await openImportTarget(target);
  } catch (error) {
    if (error instanceof PgliteLockedError) {
      console.error(`${error.message}\nStop the dev server (it holds the local database), then run this again.`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  // The per-document log lines repeat what this prints.
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    const documents = await listDocumentsForQuestions(opened.db, { toolSlug: options.tool, limit: options.limit });
    if (documents.length === 0) {
      console.log(options.tool ? `No searchable manual on ${options.tool}.` : "No searchable manuals.");
      return;
    }
    console.log(`${documents.length} searchable manual(s).`);
    const report = await runEvalQuestionsBackfill({
      db: opened.db,
      documents,
      apply: options.apply,
      force: options.force,
      log: (line) => console.log(line),
    });
    console.log(`\n${summarise(report, options.apply)}`);
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    console.info = info;
    console.warn = warn;
    await opened.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
