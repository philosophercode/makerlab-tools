import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { hasNotionCatalogEnv } from "@/lib/catalog";
import {
  CHAT_MODEL_ID,
  GATEWAY_CHAT_MODEL_ID,
  resolveChatModel,
  usesGateway,
} from "@/lib/model";
import { getNotionEnvContract } from "@/lib/notion";
import { loadCases, type EvalCase } from "./cases";
import { evalFixture } from "./fixtures";
import { composeCase } from "./harness";
import { formatReport, runSuite, type CaseExecution } from "./runner";

/**
 * `npm run eval` — the on-demand agent eval suite (design spec §5).
 *
 * **This makes real, paid model calls.** It is deliberately not part of
 * `npm test` / `npm run test:all`, which stay free, offline and green
 * (constitution Article 3), and it must never be wired into a pull-request
 * trigger.
 *
 * It runs Vitest purely as a TypeScript task runner (`evals/vitest.config.ts`),
 * which is how the harness reaches the app's real modules — the same capability
 * registry and the same `composeChat` prompt composition `/api/chat` uses. An
 * eval that tested a reimplementation of the prompt would test nothing.
 *
 * Safety rails, in order:
 *  - every `NOTION_*` variable is blanked, so the catalog is the fixed mock
 *    catalog and no Notion request is possible;
 *  - every `write` capability tool is stubbed, so an eval can never create a
 *    Notion record even if the model decides to call one;
 *  - the provider-native `web_search` / `web_fetch` tools the chat route adds
 *    are omitted — they are live network, unbounded cost and non-deterministic,
 *    and nothing in the case set depends on them.
 */

/**
 * The suite runs the deployment's own model (`@/lib/model`) so a run says
 * something about production. `EVAL_MODEL` overrides it — that is the point of
 * the harness when the question is "does the next model still behave?".
 */
const MODEL_OVERRIDE = process.env.EVAL_MODEL;
const MODEL_LABEL =
  MODEL_OVERRIDE ?? (usesGateway() ? GATEWAY_CHAT_MODEL_ID : CHAT_MODEL_ID);
const model: LanguageModel = MODEL_OVERRIDE ? anthropic(MODEL_OVERRIDE) : resolveChatModel();

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
    // Blank the Notion contract so `getCatalogTools()` serves the mock catalog
    // regardless of what the developer has in their shell.
    for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
    if (hasNotionCatalogEnv()) {
      throw new Error("refusing to run: the Notion environment is still configured");
    }
    if (!process.env.ANTHROPIC_API_KEY && !process.env.AI_GATEWAY_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY (or AI_GATEWAY_API_KEY) is required — `npm run eval` makes real model calls"
      );
    }
  });

  it("answers every case in evals/cases", async () => {
    const cases = loadCases();
    console.info(`Running ${cases.length} eval cases against ${MODEL_LABEL}…`);

    const report = await runSuite(cases, executeCase, evalFixture, {
      onCase: (result) => console.info(`  ${result.status.toUpperCase()} ${result.id}`),
    });

    console.info(formatReport(report));
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.info(`Full run written to ${REPORT_PATH}`);

    expect(report.totals.failed).toBe(0);
    expect(report.totals.errored).toBe(0);
  });
});
