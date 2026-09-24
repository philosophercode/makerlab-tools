import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { getCatalogTools, isDemoCatalog } from "@/lib/catalog";
import { gatewayLanguageModel, languageModelFor, modelIdFor } from "@/lib/ai/models";
import { getNotionEnvContract } from "@/lib/notion";
import { loadCases, type EvalCase } from "./cases";
import { buildFixture } from "./fixtures";
import { composeCase } from "./harness";
import { seedEvalManual } from "./manual-fixture";
import { formatReport, runSuite, type CaseExecution } from "./runner";

/**
 * `npm run eval` — the on-demand agent eval suite (design spec §5; gateway spec
 * §10, the eval gate).
 *
 * **This makes real, paid model calls, through the Vercel AI Gateway.** It is
 * deliberately not part of `npm test` / `npm run test:all`, which stay free,
 * offline and green (constitution Article 3), and it must never be wired into
 * a pull-request trigger.
 *
 * It runs Vitest purely as a TypeScript task runner (`evals/vitest.config.ts`),
 * which is how the harness reaches the app's real modules — the same capability
 * registry and the same `composeChat` prompt composition `/api/chat` uses. An
 * eval that tested a reimplementation of the prompt would test nothing.
 *
 * Safety rails, in order:
 *  - `DATABASE_URL` and every `NOTION_*` variable are blanked, so the catalog
 *    is the fixed demo seed in an in-process PGlite database (spec §3.2) and
 *    neither a real database nor Notion can be reached;
 *  - every `write` capability tool is stubbed, so an eval can never write a
 *    row even if the model decides to call one;
 *  - `read_page` — the one `read` capability tool that makes a real,
 *    network-calling HTTP request rather than a lookup over the fixture
 *    catalogue — is recorded the same way, so a run cannot fetch an arbitrary
 *    page the model names. See `harness.ts`'s `stubLiveReads` for why this
 *    tool, specifically, gets the write tools' treatment despite being `kind:
 *    "read"`, and why `exa_search` needs no such stub (it never reaches the
 *    harness at all — see below).
 *  - the Gateway's own `exa_search` tool, which the chat route adds directly
 *    (like the old provider-native `web_search`/`web_fetch` before it — see
 *    `src/app/api/chat/route.ts`), is never added here: `composeCase` builds
 *    the tool set from `CAPABILITIES` alone, which is a capability registry,
 *    not the route. Nothing in the case set depends on the assistant
 *    searching the live web, so this omission costs nothing.
 */

/**
 * The suite runs the deployment's own model (`@/lib/ai/models`, job `chat`) so
 * a run says something about production. `EVAL_MODEL` overrides it with an
 * explicit Gateway id (e.g. `openai/gpt-6-luna`, `anthropic/claude-sonnet-5`) —
 * that is the point of the harness when the question is "does the next model
 * still behave?".
 */
const MODEL_OVERRIDE = process.env.EVAL_MODEL;
const MODEL_LABEL = MODEL_OVERRIDE ?? modelIdFor("chat");
const model: LanguageModel = MODEL_OVERRIDE
  ? gatewayLanguageModel(MODEL_OVERRIDE, "EVAL_MODEL")
  : languageModelFor("chat");

// Resolved with path.dirname rather than `new URL(..., import.meta.url)`, which
// Vite rewrites into an asset URL instead of a filesystem path.
const REPORT_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), ".last-run.json");

/** Execute one case: the real registry and prompt composition, one model call. */
async function executeCase(evalCase: EvalCase): Promise<CaseExecution> {
  const { system, tools: aiTools } = await composeCase(evalCase);

  const result = await generateText({
    model,
    system,
    prompt: evalCase.prompt,
    tools: aiTools,
    stopWhen: stepCountIs(6),
  });

  return {
    text: result.text,
    toolCalls: result.steps.flatMap((step) =>
      step.toolCalls.map((call) => ({ name: call.toolName, input: call.input }))
    ),
    usage: {
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    },
  };
}

describe("agent evals", () => {
  beforeAll(() => {
    // Blank `DATABASE_URL` so `getCatalogTools()` serves the demo seed, and the
    // Notion contract so the write paths cannot reach Notion either, regardless
    // of what the developer has in their shell.
    vi.stubEnv("DATABASE_URL", "");
    for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
    if (!isDemoCatalog()) {
      throw new Error("refusing to run: the catalog is a real database, not the demo seed");
    }
    // Gateway-only (gateway spec §3.1): a key or the deployment's OIDC token,
    // never `ANTHROPIC_API_KEY`, which nothing in this app reads any more.
    if (!process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) {
      throw new Error(
        "AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) is required — `npm run eval` makes real model calls through the Gateway"
      );
    }
  });

  it("answers every case in evals/cases", async () => {
    // The Form 4's fixture manual, processed and searchable (manual text spec
    // §10) — one sub-cent embedding call through the Gateway.
    await seedEvalManual();
    const cases = loadCases();
    console.info(`Running ${cases.length} eval cases against ${MODEL_LABEL}…`);

    // Built from the catalogue the harness actually composes with, so an
    // assertion can never police a machine or a manual the model was not given.
    const fixture = buildFixture(await getCatalogTools());

    const report = await runSuite(cases, executeCase, fixture, {
      onCase: (result) => console.info(`  ${result.status.toUpperCase()} ${result.id}`),
    });

    console.info(formatReport(report));
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.info(`Full run written to ${REPORT_PATH}`);

    expect(report.totals.failed).toBe(0);
    expect(report.totals.errored).toBe(0);
  });
});
