import { runAssertion, type AssertionOutcome, type RecordedToolCall } from "./assertions";
import type { EvalCase } from "./cases";
import type { EvalFixture } from "./fixtures";

/**
 * The eval runner's control flow (design spec §5): for each case, execute →
 * record text and tool calls → run assertions → report.
 *
 * The model call itself is injected as a {@link CaseExecutor}. That is what
 * makes this file testable inside `npm test` with no API key: the real executor
 * (`run.eval.ts`) composes the capability registry and calls Anthropic, while
 * the tests pass a stub. The runner never imports the model.
 *
 * **Flake handling.** A failing case is retried once. A case that passes only on
 * retry is reported `FLAKY`, never as a pass — a case that flakes is usually
 * badly written, and hiding that is how a suite rots. Flaky does not fail the
 * run (design spec §11: investigate structural failures, ignore single-case
 * flakes), but it is counted and printed on its own line.
 *
 * Cases run **sequentially**. Ten cases do not need fan-out, and an unbounded
 * loop over a metered API is exactly what constitution Article 4 forbids.
 */

/** Attempts per case: the first run plus one retry. */
export const MAX_ATTEMPTS = 2;

/** Token usage for a single case, when the executor reports it. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** What one execution of a case produced. */
export interface CaseExecution {
  text: string;
  toolCalls: RecordedToolCall[];
  usage?: TokenUsage;
}

/** Runs one case against the assistant. Injected so tests can stub the model. */
export type CaseExecutor = (evalCase: EvalCase) => Promise<CaseExecution>;

/** One attempt at a case. */
export interface AttemptResult {
  ok: boolean;
  assertions: AssertionOutcome[];
  execution?: CaseExecution;
  /** Set when the executor itself threw (network, auth, timeout). */
  error?: string;
}

/** `pass` first try · `flaky` passed on retry · `fail` assertions · `error` threw. */
export type CaseStatus = "pass" | "flaky" | "fail" | "error";

export interface CaseResult {
  id: string;
  prompt: string;
  status: CaseStatus;
  attempts: AttemptResult[];
  durationMs: number;
}

export interface SuiteTotals {
  total: number;
  passed: number;
  flaky: number;
  failed: number;
  errored: number;
}

export interface SuiteReport {
  startedAt: string;
  durationMs: number;
  /** False when any case failed or errored. Flaky cases do not fail the run. */
  ok: boolean;
  totals: SuiteTotals;
  usage: TokenUsage;
  cases: CaseResult[];
}

/** Run every assertion of a case against one execution. */
function assess(
  evalCase: EvalCase,
  execution: CaseExecution,
  fixture: EvalFixture
): AssertionOutcome[] {
  return evalCase.assert.map((spec) =>
    runAssertion(spec, {
      text: execution.text,
      toolCalls: execution.toolCalls,
      fixture,
      toolId: evalCase.context.toolId,
    })
  );
}

async function attempt(
  evalCase: EvalCase,
  executor: CaseExecutor,
  fixture: EvalFixture
): Promise<AttemptResult> {
  let execution: CaseExecution;
  try {
    execution = await executor(evalCase);
  } catch (error) {
    return {
      ok: false,
      assertions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const assertions = assess(evalCase, execution, fixture);
  return { ok: assertions.every((outcome) => outcome.ok), assertions, execution };
}

/** Classify a case from its attempts. */
function classify(attempts: AttemptResult[]): CaseStatus {
  if (attempts[0].ok) return "pass";
  const last = attempts[attempts.length - 1];
  if (last.ok) return "flaky";
  return attempts.every((a) => a.error !== undefined) ? "error" : "fail";
}

/** Run one case, retrying once on failure. */
export async function runCase(
  evalCase: EvalCase,
  executor: CaseExecutor,
  fixture: EvalFixture,
  now: () => number = Date.now
): Promise<CaseResult> {
  const started = now();
  const attempts: AttemptResult[] = [];

  for (let n = 0; n < MAX_ATTEMPTS; n++) {
    attempts.push(await attempt(evalCase, executor, fixture));
    if (attempts[attempts.length - 1].ok) break;
  }

  return {
    id: evalCase.id,
    prompt: evalCase.prompt,
    status: classify(attempts),
    attempts,
    durationMs: now() - started,
  };
}

export interface RunSuiteOptions {
  /** Called as each case finishes, for live progress output. */
  onCase?: (result: CaseResult) => void;
  now?: () => number;
}

/** Run every case sequentially and summarize. */
export async function runSuite(
  cases: EvalCase[],
  executor: CaseExecutor,
  fixture: EvalFixture,
  options: RunSuiteOptions = {}
): Promise<SuiteReport> {
  const now = options.now ?? Date.now;
  const started = now();
  const results: CaseResult[] = [];

  for (const evalCase of cases) {
    const result = await runCase(evalCase, executor, fixture, now);
    results.push(result);
    options.onCase?.(result);
  }

  const totals: SuiteTotals = {
    total: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    flaky: results.filter((r) => r.status === "flaky").length,
    failed: results.filter((r) => r.status === "fail").length,
    errored: results.filter((r) => r.status === "error").length,
  };

  const usage = results.reduce<TokenUsage>(
    (sum, result) => {
      for (const a of result.attempts) {
        sum.inputTokens += a.execution?.usage?.inputTokens ?? 0;
        sum.outputTokens += a.execution?.usage?.outputTokens ?? 0;
      }
      return sum;
    },
    { inputTokens: 0, outputTokens: 0 }
  );

  return {
    startedAt: new Date(started).toISOString(),
    durationMs: now() - started,
    ok: totals.failed === 0 && totals.errored === 0,
    totals,
    usage,
    cases: results,
  };
}

// ── Reporting ──────────────────────────────────────────────────────

const LABEL: Record<CaseStatus, string> = {
  pass: "PASS ",
  flaky: "FLAKY",
  fail: "FAIL ",
  error: "ERROR",
};

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/**
 * Detail block for a case that did not pass. A failure that requires re-running
 * the eval by hand to understand is a failure nobody investigates, so this
 * prints the prompt, every failed assertion with its expectation and reason,
 * and the part of the answer that caused it (design spec §5).
 */
function describeFailure(result: CaseResult): string[] {
  const lines: string[] = [`${LABEL[result.status].trim()}  ${result.id}`];
  lines.push(`  prompt: ${truncate(result.prompt, 160)}`);

  result.attempts.forEach((attemptResult, index) => {
    const which = result.attempts.length > 1 ? ` (attempt ${index + 1})` : "";
    if (attemptResult.error) {
      lines.push(`  ! executor threw${which}: ${attemptResult.error}`);
      return;
    }
    for (const outcome of attemptResult.assertions.filter((o) => !o.ok)) {
      lines.push(`  x ${outcome.kind}${which} — expected ${outcome.expected}`);
      lines.push(`      ${outcome.detail}`);
      if (outcome.excerpt) lines.push(`      answer: "${truncate(outcome.excerpt, 200)}"`);
    }
    if (attemptResult.ok) lines.push(`  ✓ passed on retry`);
  });

  const answer = result.attempts[0]?.execution?.text;
  if (answer) lines.push(`  full answer: ${truncate(answer, 400)}`);
  const calls = result.attempts[0]?.execution?.toolCalls;
  if (calls) lines.push(`  tool calls: ${calls.map((c) => c.name).join(", ") || "none"}`);

  return lines;
}

/** Render a report for the console. */
export function formatReport(report: SuiteReport): string {
  const seconds = (report.durationMs / 1000).toFixed(1);
  const lines: string[] = [
    "",
    `Agent evals — ${report.totals.total} cases in ${seconds}s`,
    "",
  ];

  for (const result of report.cases) {
    lines.push(`  ${LABEL[result.status]} ${result.id}`);
  }

  const notPassed = report.cases.filter((result) => result.status !== "pass");
  if (notPassed.length > 0) {
    lines.push("");
    for (const result of notPassed) {
      lines.push(...describeFailure(result), "");
    }
  }

  const { passed, flaky, failed, errored, total } = report.totals;
  lines.push(
    `${passed}/${total} passed · ${flaky} flaky · ${failed} failed · ${errored} errored`,
    `tokens: ~${report.usage.inputTokens} in / ~${report.usage.outputTokens} out`,
    ""
  );

  return lines.join("\n");
}
