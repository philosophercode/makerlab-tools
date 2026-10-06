import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generateText, stepCountIs, type LanguageModel } from "ai";
import { getCatalogTools, isDemoCatalog } from "@/lib/catalog";
import { chatProviderOptions, gatewayLanguageModel, languageModelFor, modelIdFor } from "@/lib/ai/models";
import { getNotionEnvContract } from "@/lib/notion";
import { loadCases, type EvalCase } from "./cases";
import { buildFixture } from "./fixtures";
import { caseMessages, composeCase } from "./harness";
import { getDb } from "@/lib/db/client";
import { attachManualsToFirstUserMessage } from "@/lib/chat/attached-manuals";
import { evidenceUrls } from "@/lib/manuals/citation-check";
import { gatherCitationEvidence } from "@/lib/manuals/citation-evidence";
import { recordedPassages } from "./assertions";
import { seedEvalLabManuals, seedEvalManual, stopEvalManualServer } from "./manual-fixture";
import { seedEvalTickets } from "./ticket-fixture";
import { formatReport, mergeReports, runSuite, type CaseExecution, type SuiteReport } from "./runner";
import { seedEvalLabCatalog } from "./lab-catalog-fixture";

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
  const { system, tools: aiTools, manuals, attachedManuals, qrHints } = await composeCase(evalCase);

  const result = await generateText({
    model,
    system,
    // The chat route's own call options — its reasoning effort and prompt-cache
    // key (`MODEL_CHAT_REASONING`, `MODEL_CHAT_CACHE_KEY`) — so a run gates the
    // settings production uses. An OpenAI block is ignored by other providers.
    providerOptions: chatProviderOptions(),
    // The case's history, then its prompt: a single user message for most —
    // with the focused tool's unsearchable manuals attached as PDFs, as the
    // route attaches them.
    messages: attachManualsToFirstUserMessage(caseMessages(evalCase), manuals),
    tools: aiTools,
    stopWhen: stepCountIs(6),
  });

  const outputs = new Map(
    result.steps.flatMap((step) => step.toolResults.map((r) => [r.toolCallId, r.output] as const))
  );
  const toolCalls = result.steps.flatMap((step) =>
    step.toolCalls.map((call) => ({ name: call.toolName, input: call.input, output: outputs.get(call.toolCallId) }))
  );
  // What every cited manual address answers, for `citations_resolve`: a GET on
  // the eval's local blob origin and the stored page texts (one real request
  // per cited PDF, no model call). An attached manual's page is resolved
  // against what the route would have streamed for this turn.
  const urls = evidenceUrls(result.text, recordedPassages(toolCalls), attachedManuals);
  const evidence = urls.length > 0 ? await gatherCitationEvidence(urls, { db: await getDb() }) : new Map();

  return {
    text: result.text,
    toolCalls,
    attachedManuals,
    ...(qrHints.length > 0 ? { qrHints } : {}),
    citationEvidence: Object.fromEntries(
      [...evidence].map(([url, e]) => [url, { ...e, pages: Object.fromEntries(e.pages) }])
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

  afterAll(async () => {
    await stopEvalManualServer();
  });

  it("answers every case in evals/cases", async () => {
    // The Form 4's fixture manual, processed and searchable (manual text spec
    // §10) — one sub-cent embedding call through the Gateway.
    await seedEvalManual();
    // An open Form 4 ticket for the staff maintenance cases.
    await seedEvalTickets();
    // `EVAL_CASES=staff-maintenance` runs one case file (or a comma list of
    // files or case ids) — a cheap way to check one behaviour.
    const only = (process.env.EVAL_CASES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const cases = loadCases().filter(
      (c) => only.length === 0 || only.includes(c.id) || only.includes(c.file.replace(/\.ya?ml$/, ""))
    );
    if (cases.length === 0) throw new Error(`EVAL_CASES="${process.env.EVAL_CASES}" matches no case file or id`);
    console.info(`Running ${cases.length} eval cases against ${MODEL_LABEL}…`);

    // Two phases: every demo-catalogue case first, then — once the lab
    // fixture's look-alike machines are seeded, which is never undone — the
    // `catalog: lab` cases (photo identification). Each phase's fixture is
    // built from the catalogue the harness actually composes with, so an
    // assertion can never police a machine or a manual the model was not given.
    const onCase = (result: { status: string; id: string }) => console.info(`  ${result.status.toUpperCase()} ${result.id}`);
    const phases: SuiteReport[] = [];
    const demoCases = cases.filter((c) => c.context.catalog !== "lab");
    const labCases = cases.filter((c) => c.context.catalog === "lab");
    if (demoCases.length > 0) {
      phases.push(await runSuite(demoCases, executeCase, buildFixture(await getCatalogTools()), { onCase }));
    }
    if (labCases.length > 0) {
      await seedEvalLabCatalog();
      // The look-alikes' manuals (Prusa handbook, Epilog manual), searchable:
      // the near-misses the tool-scoped citation cases must not cite.
      await seedEvalLabManuals();
      phases.push(await runSuite(labCases, executeCase, buildFixture(await getCatalogTools()), { onCase }));
    }
    const report = mergeReports(phases);

    console.info(formatReport(report));
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.info(`Full run written to ${REPORT_PATH}`);

    expect(report.totals.failed).toBe(0);
    expect(report.totals.errored).toBe(0);
  });
});
