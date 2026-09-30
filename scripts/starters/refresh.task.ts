import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { modelIdFor } from "@/lib/ai/models";
import { dataSubstrate, getDb } from "@/lib/db/client";
import { listPublishedStarterTools, type StarterTool } from "@/lib/data/starter-answers";
import { isUuid } from "@/lib/data/uuid";
import { describeStarterCatalog, describeStarterTool, runStarterAnswer } from "@/lib/starters/answer";
import { mapConcurrent, parseRefreshArgs } from "@/lib/starters/args";
import { chipStates } from "@/lib/starters/cache";
import { loadGeneralCoverage, loadLabSummary, loadStarterToolContext } from "@/lib/starters/context";
import { GENERAL_REFINE_NOTE, generalChipQuestions } from "@/lib/starters/general";
import { gradeStarterAnswer } from "@/lib/starters/grade";
import { writeReplacementQuestions } from "@/lib/starters/refine";
import { estimateUsd, refreshChipSet, type ChipSetReport, type RefreshDeps } from "@/lib/starters/refresh";
import { buildRunReport, chipSetLine, markdownSummary, runSummaryLines } from "@/lib/starters/report";

/**
 * `npm run starters:refresh` — the task itself (starter answers). Started by
 * `scripts/starters-refresh.ts`, which passes the arguments in
 * `STARTERS_REFRESH_ARGS`, under Vitest as a TypeScript runner
 * (`scripts/starters/vitest.config.ts`) — the way `npm run eval` reaches the
 * app's real modules: the chat's registry, `composeChat`, the catalogue.
 *
 * **Real, paid model calls through the Gateway**, against the database
 * `getDb()` opens: `DATABASE_URL`, else `PGLITE_DATA_DIR` (stop the dev
 * server first — the local database is single-process). It refuses the demo
 * seed. `--dry-run` (the default) writes nothing to the database.
 */

const DEPS: RefreshDeps = {
  answer: ({ question, toolId }) => runStarterAnswer({ question, toolId }),
  grade: (input) => gradeStarterAnswer(input),
  write: (input) => writeReplacementQuestions(input),
};

function describeTarget(): string {
  const substrate = dataSubstrate();
  if (substrate === "neon") {
    try {
      return `DATABASE_URL (${new URL(process.env.DATABASE_URL ?? "").host})`;
    } catch {
      return "DATABASE_URL";
    }
  }
  return substrate === "pglite-local" ? `the local PGlite database at ${process.env.PGLITE_DATA_DIR}` : "the demo seed";
}

async function main(): Promise<void> {
  const args = parseRefreshArgs(JSON.parse(process.env.STARTERS_REFRESH_ARGS ?? "[]") as string[]);
  if (dataSubstrate() === "pglite-demo") {
    throw new Error("Refusing to run against the demo seed: set DATABASE_URL, or PGLITE_DATA_DIR for a local database.");
  }
  if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
    throw new Error("AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) is required — this makes real model calls through the Gateway.");
  }
  const db = await getDb();
  const startedAt = new Date().toISOString();
  const models = { chat: modelIdFor("chat"), grade: modelIdFor("starterGrade"), write: modelIdFor("researchRead") };
  console.log(`Target: ${describeTarget()}${args.apply ? "" : " — dry run, nothing is written"}`);
  console.log(`Models: chat ${models.chat}, grader ${models.grade} (flex), question writer ${models.write} (flex)`);

  // Which tools: every published tool with chips, narrowed by --ids, then —
  // unless --force — those with a chip that is not cached and current.
  let candidates: StarterTool[] = await listPublishedStarterTools(db);
  if (args.ids) {
    const wanted = new Set(args.ids);
    candidates = candidates.filter((tool) => wanted.has(tool.slug) || (isUuid(tool.id) && wanted.has(tool.id)));
  }
  if (!args.force) {
    const states = await chipStates(db, candidates.map((tool) => ({ toolId: tool.id, questions: tool.starterQuestions })));
    candidates = candidates.filter((tool) => (states.get(tool.id) ?? []).some((chip) => chip.status !== "cached"));
  }
  if (args.limit !== null) candidates = candidates.slice(0, args.limit);
  const general = args.general ? generalChipQuestions() : null;

  const chips = candidates.reduce((n, tool) => n + tool.starterQuestions.length, 0) + (general?.length ?? 0);
  const estimate = estimateUsd(chips);
  console.log(`${candidates.length} tool(s)${general ? " + the general chips" : ""}, ${chips} chip(s). Estimated cost ~$${estimate.toFixed(3)}.`);

  const reports: ChipSetReport[] = [];
  if (general) {
    console.log("General chips");
    const [summary, listing, coverage] = await Promise.all([loadLabSummary(db), describeStarterCatalog(), loadGeneralCoverage(db)]);
    const record = `${summary}\n\n${listing}`;
    const report = await refreshChipSet({
      db,
      deps: DEPS,
      apply: args.apply,
      tool: null,
      general: { questions: general, record, coverage, note: GENERAL_REFINE_NOTE },
      maxRounds: args.rounds,
      log: (line) => console.log(line),
    });
    console.log(chipSetLine(report));
    reports.push(report);
  }

  const toolReports = await mapConcurrent(candidates, args.concurrency, async (tool, index) => {
    const [loaded, described] = await Promise.all([loadStarterToolContext(db, tool.id), describeStarterTool(tool.id)]);
    // The record the grader and writer read is the chat's own block for the
    // tool (training level, PPE, resources…), when the catalogue has it.
    const context = loaded && described ? { ...loaded, record: described } : loaded;
    const lines: string[] = [`[${index + 1}/${candidates.length}] ${tool.name} (${tool.slug})`];
    try {
      if (!context) throw new Error("the tool disappeared");
      const report = await refreshChipSet({
        db,
        deps: DEPS,
        apply: args.apply,
        tool: { ...tool, context },
        maxRounds: args.rounds,
        log: (line) => lines.push(line),
      });
      lines.push(chipSetLine(report));
      return report;
    } catch (error) {
      lines.push(`  failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      console.log(lines.join("\n"));
    }
  });
  reports.push(...toolReports.filter((r): r is ChipSetReport => r !== null));

  const run = buildRunReport({ startedAt, target: describeTarget(), apply: args.apply, models, estimateUsd: estimate, chipSets: reports });
  const out = args.out ?? path.join(os.tmpdir(), `starters-refresh-${startedAt.replace(/[:.]/g, "-")}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(run, null, 2)}\n`);
  const md = out.replace(/\.json$/, "") + ".md";
  writeFileSync(md, markdownSummary(run));
  for (const line of runSummaryLines(run)) console.log(line);
  console.log(`Report: ${out}\nSummary: ${md}`);
  if (toolReports.some((r) => r === null)) process.exitCode = 1;
  if (args.apply) console.log("Tool pages cache the catalogue: the new questions show once it refreshes (or POST /api/admin/revalidate).");
}

describe("starters:refresh", () => {
  it("runs", async () => {
    await main();
  });
});
