/**
 * Backfill tool skills (tool skills spec 2026-10-07 §5.4):
 *
 *   npm run tools:skills -- [--apply] [--tool <slug>] [--limit N] [--force]
 *
 * With "Write a tool skill after research" on, a new tool gets its skill after
 * approval and a refreshed one when its manuals are indexed. Tools already in
 * the catalogue have none; this writes them.
 *
 * - **A dry run by default.** It lists every tool that is not archived, says
 *   what each would get (a new version, from how many manual passages, with
 *   research and lab notes or not) or why it is skipped (up to date, nothing
 *   to write from), and prints the estimated cost at Luna's list price. It
 *   calls no model and writes nothing. `--apply` calls job `skillWrite` (Luna
 *   on flex) once per tool that needs one and stores the skill
 *   (`trigger: "backfill"`); each line and the summary print the
 *   Gateway-reported cost. The lab's daily cap does not stop the backfill
 *   (you ran it, with a dry run and `--limit`), but its rows count toward it.
 * - **Target** is the import scripts' order (`src/lib/import/target.ts`):
 *   `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev server first: the
 *   local database is single-process).
 * - **Which tools:** every tool not archived, by name; `--tool` takes one
 *   slug; `--limit` the first N. A tool whose current skill was written from
 *   the same inputs is skipped; `--force` writes every one again.
 *
 * Output: one line per tool (slug, what happened, tokens, cost), then totals.
 */
import { fileURLToPath } from "node:url";
import type { LanguageModel } from "ai";
import type { SkillTarget } from "../src/lib/data/tool-skills.ts";
import { PgliteLockedError } from "../src/lib/db/pglite-lock.ts";
import type { Db } from "../src/lib/db/types.ts";
import type { ToolSkillOutcome } from "../src/lib/skills/write.ts";
import { estimateUsd } from "./manual-eval-questions.ts";

// ── Arguments ───────────────────────────────────────────────────────

export interface ToolSkillsBackfillOptions {
  apply: boolean;
  force: boolean;
  /** One tool's slug; null for every tool. */
  tool: string | null;
  limit: number | null;
}

export const USAGE = "Usage: npm run tools:skills -- [--apply] [--tool <slug>] [--limit N] [--force]";

export function parseArgs(argv: readonly string[]): ToolSkillsBackfillOptions {
  const options: ToolSkillsBackfillOptions = { apply: false, force: false, tool: null, limit: null };
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
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`--tool takes a tool's slug (e.g. form-4); "${slug}" is not one.`);
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

export interface ToolSkillsBackfillReport {
  tools: number;
  written: number;
  planned: number;
  upToDate: number;
  nothingToWrite: number;
  /** Skipped for any other reason (gone, the lab's cap). */
  skipped: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** Gateway-reported dollars (`--apply`); null when none was reported. */
  cost: number | null;
  /** The dry run's estimate at Luna's list price. */
  estimatedUsd: number;
  ms: number;
}

export interface RunToolSkillsBackfillInput {
  db: Db;
  tools: readonly SkillTarget[];
  apply: boolean;
  force?: boolean;
  /** The model; the deployment's `skillWrite` job by default. Tests pass a stub. */
  model?: LanguageModel;
  log?: (line: string) => void;
}

/** One tool at a time, each reported as it finishes. A failure is counted and the run goes on. */
export async function runToolSkillsBackfill(input: RunToolSkillsBackfillInput): Promise<ToolSkillsBackfillReport> {
  const { writeToolSkill } = await import("../src/lib/skills/write.ts");
  const log = input.log ?? (() => {});
  const started = Date.now();
  const report: ToolSkillsBackfillReport = {
    tools: input.tools.length,
    written: 0,
    planned: 0,
    upToDate: 0,
    nothingToWrite: 0,
    skipped: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    estimatedUsd: 0,
    ms: 0,
  };
  for (const [n, tool] of input.tools.entries()) {
    const prefix = `[${n + 1}/${input.tools.length}] ${tool.slug}${tool.published ? "" : " (draft)"}:`;
    let outcome: ToolSkillOutcome;
    try {
      outcome = await writeToolSkill(input.db, tool.id, { trigger: "backfill", dryRun: !input.apply, force: input.force, model: input.model });
    } catch (error) {
      report.failed += 1;
      log(`${prefix} error ${error instanceof Error ? error.message.split("\n")[0].slice(0, 160) : "unknown"}`);
      continue;
    }
    log(`${prefix} ${describeOutcome(outcome)}`);
    switch (outcome.status) {
      case "written":
        report.written += 1;
        report.inputTokens += outcome.inputTokens;
        report.outputTokens += outcome.outputTokens;
        if (outcome.cost !== null) report.cost = (report.cost ?? 0) + outcome.cost;
        break;
      case "planned":
        report.planned += 1;
        report.inputTokens += outcome.estimatedInputTokens;
        report.outputTokens += outcome.estimatedOutputTokens;
        break;
      case "skipped":
        if (outcome.reason === "up_to_date") report.upToDate += 1;
        else if (outcome.reason === "nothing_to_write") report.nothingToWrite += 1;
        else report.skipped += 1;
        break;
      case "failed":
        report.failed += 1;
        break;
    }
  }
  report.estimatedUsd = estimateUsd(report.inputTokens, report.outputTokens);
  report.ms = Date.now() - started;
  return report;
}

export function describeOutcome(outcome: ToolSkillOutcome): string {
  switch (outcome.status) {
    case "written":
      return (
        `wrote version ${outcome.version} (${outcome.removed} line(s) removed by the checks), ${outcome.inputTokens}/${outcome.outputTokens} tokens, ` +
        `${outcome.cost === null ? "cost not reported" : `cost $${outcome.cost.toFixed(5)}`}, ${(outcome.ms / 1000).toFixed(1)}s`
      );
    case "planned": {
      const from = [
        `${outcome.passages} manual passage(s)`,
        outcome.hasResearch ? "research" : null,
        outcome.notes > 0 ? `${outcome.notes} lab note(s)` : null,
      ].filter(Boolean);
      return `would write version ${outcome.version} from ${from.join(", ")}, ~${outcome.estimatedInputTokens}/${outcome.estimatedOutputTokens} tokens`;
    }
    case "skipped":
      if (outcome.reason === "up_to_date") return `skipped (up to date, version ${outcome.version})`;
      if (outcome.reason === "nothing_to_write") return "skipped (nothing to write from: no searchable public manual, research or lab notes)";
      return `skipped (${outcome.reason.replace(/_/g, " ")})`;
    case "failed":
      return `failed (${outcome.reason}${outcome.kind ? `: ${outcome.kind}` : ""}${outcome.transient ? ", transient" : ""})`;
  }
}

export function summarise(report: ToolSkillsBackfillReport, apply: boolean): string {
  const rest =
    `${report.upToDate} up to date, ${report.nothingToWrite} with nothing to write from` +
    `${report.skipped ? `, ${report.skipped} skipped` : ""}${report.failed ? `, ${report.failed} failed` : ""}`;
  if (!apply) {
    return (
      `Dry run: ${report.planned} tool(s) would get a skill (${rest}). ` +
      `About ${report.inputTokens} input and ${report.outputTokens} output tokens: ~$${report.estimatedUsd.toFixed(4)} at Luna's list price ` +
      `(flex is cheaper). Run again with --apply to write them.`
    );
  }
  return (
    `Wrote ${report.written} skill(s) (${rest}). ` +
    `${report.inputTokens}/${report.outputTokens} tokens, ` +
    `${report.cost === null ? "cost not reported" : `Gateway cost $${report.cost.toFixed(4)}`} in ${(report.ms / 1000).toFixed(1)}s.`
  );
}

// ── The command ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  let options: ToolSkillsBackfillOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const { modelIdFor } = await import("../src/lib/ai/models.ts");
  const model = modelIdFor("skillWrite");
  const { describeImportTarget, NoImportTargetError, openImportTarget, resolveImportTarget } = await import("../src/lib/import/target.ts");
  let target;
  try {
    target = resolveImportTarget();
  } catch (error) {
    if (!(error instanceof NoImportTargetError)) throw error;
    // Even the dry run reads the real tools: there is no in-memory rehearsal here.
    console.error("No database to read. Set DATABASE_URL (Neon) or PGLITE_DATA_DIR (a local database, e.g. .pglite-data).");
    process.exitCode = 1;
    return;
  }
  console.log(`Target: ${describeImportTarget(target)}${options.apply ? "" : " — dry run, no model call, nothing is written"}`);
  console.log(`Skills: job skillWrite (${model}, flex)${options.force ? ", every tool again (--force)" : ""}`);
  if (!options.apply && model !== "openai/gpt-6-luna") {
    console.log("Note: MODEL_SKILL_WRITE names another model; the estimate below uses Luna's list price.");
  }

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
  // The per-tool log lines repeat what this prints.
  const info = console.info;
  const warn = console.warn;
  console.info = () => {};
  console.warn = () => {};
  try {
    const { listToolsForSkills } = await import("../src/lib/data/tool-skills.ts");
    const tools = await listToolsForSkills(opened.db, { toolSlug: options.tool, limit: options.limit });
    if (tools.length === 0) {
      console.log(options.tool ? `No tool ${options.tool} (or it is archived).` : "No tools.");
      return;
    }
    console.log(`${tools.length} tool(s).`);
    const report = await runToolSkillsBackfill({
      db: opened.db,
      tools,
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
