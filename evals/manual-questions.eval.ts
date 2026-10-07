import path from "node:path";
import { fileURLToPath } from "node:url";
import { getCatalogTools } from "@/lib/catalog";
import { dataSubstrate, getDb } from "@/lib/db/client";
import { getNotionEnvContract } from "@/lib/notion";
import { runStarterAnswer } from "@/lib/starters/answer";
import { fakeEmbeddingTarget } from "../test/ai/fake-embeddings";
import { buildFixture } from "./fixtures";
import { seedEvalManual, stopEvalManualServer } from "./manual-fixture";
import { seedEvalManualQuestions } from "./manual-questions-fixture";
import {
  formatManualQuestionReport,
  parseManualQuestionEvalEnv,
  runManualQuestionEval,
  type ManualQuestionEvalOptions,
} from "./manual-questions";

/**
 * `npm run eval:manual-questions` — the manual question eval (manual text spec
 * amendment 2026-10-07). Vitest as a TypeScript task runner, like
 * `npm run eval` (`evals/manual-questions.vitest.config.ts`).
 *
 * The questions are the ones written from the lab's manuals when they were
 * indexed (`manual_eval_questions`), read from the database `getDb()` opens:
 * `DATABASE_URL`, else `PGLITE_DATA_DIR`. It refuses the demo seed unless
 * `EVAL_MQ_FIXTURES=1`, which runs on the eval's own Form 4 manual and scan
 * with hand-written questions instead. It only reads: the end-to-end check
 * runs the chat headless with every write stubbed, as `starters:refresh` does.
 *
 * - **Retrieval** (always): query embeddings and reranks only, a fraction of
 *   a cent per question. Reported, never failed: recall is a measure.
 * - **End to end** (`EVAL_MQ_E2E=1`): one real chat turn per public question
 *   (~$0.001–0.003 each). A failed answer fails the run, as `npm run eval`
 *   does.
 *
 * Options: `EVAL_MQ_TOOL=<slug>`, `EVAL_MQ_K=8`, `EVAL_MQ_LIMIT=N`,
 * `EVAL_MQ_RERANK=0`, `EVAL_MQ_OFFLINE=1` (fixtures only: fake embeddings, no
 * reranker, no network). One JSON report per run in `evals/.manual-questions/`.
 */

const REPORT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), ".manual-questions");

let options: ManualQuestionEvalOptions;

describe("manual question eval", () => {
  beforeAll(() => {
    options = parseManualQuestionEvalEnv(process.env);
    for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
    if (options.fixtures) {
      vi.stubEnv("DATABASE_URL", "");
      vi.stubEnv("PGLITE_DATA_DIR", "");
    } else if (dataSubstrate() === "pglite-demo") {
      throw new Error(
        "Refusing to run on the demo seed: set PGLITE_DATA_DIR (a local copy) or DATABASE_URL, or EVAL_MQ_FIXTURES=1 for the eval's fixture manuals."
      );
    }
    if (!options.offline && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error("AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) is required: the search embeds each question through the Gateway.");
    }
    const substrate = dataSubstrate();
    console.info(
      `Database: ${substrate === "neon" ? "DATABASE_URL (read only)" : substrate === "pglite-local" ? "the local PGlite database" : "the demo seed with the eval fixtures"}` +
        `${options.e2e ? " · end to end: real chat turns, paid" : " · retrieval only"}`
    );
  });

  afterAll(async () => {
    await stopEvalManualServer();
  });

  it("finds each question's page, and with EVAL_MQ_E2E=1 the answer cites it", async () => {
    const target = options.offline ? fakeEmbeddingTarget() : undefined;
    if (options.fixtures) {
      await seedEvalManual(target ? { target } : {});
      await seedEvalManualQuestions();
    }
    const { report, file } = await runManualQuestionEval(options, {
      db: await getDb(),
      fixture: buildFixture(await getCatalogTools()),
      ...(target ? { target } : {}),
      ...(options.e2e
        ? { answer: (question) => runStarterAnswer({ question: question.question, toolId: question.toolId }) }
        : {}),
      reportDir: REPORT_DIR,
      log: (line) => console.info(line),
    });
    console.info(formatManualQuestionReport(report));
    console.info(`Report written to ${file}`);
    if (report.endToEnd) {
      expect(report.endToEnd.totals.failed).toBe(0);
      expect(report.endToEnd.totals.errored).toBe(0);
    }
  });
});
