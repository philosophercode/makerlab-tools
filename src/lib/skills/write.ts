import { generateText, type LanguageModel } from "ai";
import { classifyModelError, type ModelErrorKind } from "../ai/gateway-errors.ts";
import { describeGatewayCall, gatewayCallReport } from "../ai/gateway-usage.ts";
import { languageModelFor, modelIdFor, providerOptionsFor } from "../ai/models.ts";
import { countToolSkillsSince, insertToolSkill, latestToolSkill, currentToolSkill } from "../data/tool-skills.ts";
import type { ToolSkillTrigger } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { composeSkillSections } from "./compose.ts";
import { draftSize } from "./format.ts";
import { skillInputHash } from "./hash.ts";
import { assembleSkillInputs, hasSkillMaterial, type SkillInputs } from "./inputs.ts";
import { SKILL_DAILY_LIMIT, SKILL_WRITE_MAX_RETRIES, SKILL_WRITE_TIMEOUT_MS } from "./limits.ts";
import { guardSkillDraft } from "./numbers-guard.ts";
import { parseSkillDraft } from "./parse.ts";
import { buildSkillPrompt, SKILL_PROMPT_VERSION, SKILL_SYSTEM_PROMPT } from "./prompt.ts";
import { renderSkillMarkdown } from "./render.ts";

/**
 * Write one tool's skill (tool skills spec 2026-10-07 §5.2, §5.3): assemble its
 * sources, hash them, skip when nothing changed, ask job `skillWrite` (Luna,
 * flex) once, read and check the answer, put the lab's facts first, render
 * the markdown and store the row with the Gateway's cost.
 *
 * - **Skips** (no model call): a tool that is gone or archived
 *   (`not_found`); one with nothing beyond its catalogue record to write from
 *   (`nothing_to_write`); without `force`, one whose current skill has this
 *   hash (`up_to_date`), and — for the automatic pass after research only —
 *   one whose latest attempt failed on this hash (`failed_before`), so a
 *   machine the model cannot write for is not retried every night; past the
 *   daily cap, when `enforceCap` (`daily_limit`).
 * - **Fails as values.** A transient model failure (rate limit, a provider's
 *   bad minute, a timeout, no answer) is returned with `transient: true` and
 *   stores nothing: the workflow step retries it and stores one failed row
 *   after the last try. Anything else — an unreadable answer, nothing left
 *   after the checks, a refused or misconfigured model — stores a `failed`
 *   row with its reason and the cost spent. The current skill keeps serving.
 * - **Throws only for the database.**
 *
 * Logs ids, counts, tokens and cost only — never the prompt or the skill.
 * Plain Node: the workflow step and the backfill script call it.
 */

export type ToolSkillOutcome =
  | {
      status: "written";
      toolId: string;
      version: number;
      inputTokens: number;
      outputTokens: number;
      /** Dollars the Gateway reported; null when it reported none. */
      cost: number | null;
      /** Items the checks took out. */
      removed: number;
      model: string;
      ms: number;
    }
  | {
      status: "skipped";
      toolId: string;
      /** `disabled`: the pass after research found the lab setting off when its step ran (`steps.ts`). */
      reason: "not_found" | "nothing_to_write" | "up_to_date" | "failed_before" | "daily_limit" | "disabled";
      /** The current skill's version, when there is one. */
      version?: number;
    }
  | {
      /** A dry run: what one call would be asked. Nothing called, nothing written. */
      status: "planned";
      toolId: string;
      /** The version the write would store. */
      version: number;
      passages: number;
      hasResearch: boolean;
      notes: number;
      estimatedInputTokens: number;
      estimatedOutputTokens: number;
    }
  | {
      status: "failed";
      toolId: string;
      reason: "model" | "unreadable" | "empty";
      kind: ModelErrorKind | "unknown" | null;
      transient: boolean;
      /** True when a failed row was stored (every non-transient failure). */
      recorded: boolean;
    };

export interface WriteToolSkillOptions {
  trigger: ToolSkillTrigger;
  /** Write even when the inputs have not changed (Rewrite, the backfill's `--force`). */
  force?: boolean;
  /** Plan and estimate; call no model and write nothing (the backfill's default). */
  dryRun?: boolean;
  /** Refuse past {@link SKILL_DAILY_LIMIT} (the automatic pass and Write skill). */
  enforceCap?: boolean;
  /** The model; the deployment's `skillWrite` job by default. Tests pass a stub. */
  model?: LanguageModel;
  /** "Now", for the cap's window. Tests pin it. */
  now?: Date;
}

/** Output tokens a skill costs, reasoning included: a measured shape, not a promise (the Gateway's cost is the real figure). */
export const ESTIMATED_SKILL_OUTPUT_TOKENS = 4_000;

const TRANSIENT_KINDS: readonly ModelErrorKind[] = ["rate_limited", "provider_unavailable", "timeout"];
const DAY_MS = 24 * 60 * 60_000;

export async function writeToolSkill(db: Db, toolId: string, options: WriteToolSkillOptions): Promise<ToolSkillOutcome> {
  const inputs = await assembleSkillInputs(db, toolId);
  if (!inputs) return { status: "skipped", toolId, reason: "not_found" };
  const current = await currentToolSkill(db, toolId);
  if (!hasSkillMaterial(inputs)) {
    return { status: "skipped", toolId, reason: "nothing_to_write", ...(current ? { version: current.version } : {}) };
  }

  const modelId = options.model ? labelOf(options.model) : modelIdFor("skillWrite");
  const inputHash = skillInputHash(inputs, { model: modelId, promptVersion: SKILL_PROMPT_VERSION });
  const latest = await latestToolSkill(db, toolId);
  if (!options.force) {
    if (current?.inputHash === inputHash) return { status: "skipped", toolId, reason: "up_to_date", version: current.version };
    if (options.trigger === "research" && latest?.status === "failed" && latest.inputHash === inputHash) {
      return { status: "skipped", toolId, reason: "failed_before", ...(current ? { version: current.version } : {}) };
    }
  }

  const prompt = buildSkillPrompt(inputs);
  if (options.dryRun) {
    return {
      status: "planned",
      toolId,
      version: (latest?.version ?? 0) + 1,
      passages: inputs.passages.length,
      hasResearch: inputs.research !== null,
      notes: inputs.toolNotes.length,
      estimatedInputTokens: Math.ceil((SKILL_SYSTEM_PROMPT.length + prompt.length) / 4),
      estimatedOutputTokens: ESTIMATED_SKILL_OUTPUT_TOKENS,
    };
  }
  if (options.enforceCap) {
    const since = new Date((options.now ?? new Date()).getTime() - DAY_MS);
    if ((await countToolSkillsSince(db, since)) >= SKILL_DAILY_LIMIT) {
      console.warn(`[skills] daily limit reached; skipped tool=${toolId}`);
      return { status: "skipped", toolId, reason: "daily_limit", ...(current ? { version: current.version } : {}) };
    }
  }

  const started = Date.now();
  let result;
  try {
    result = await generateText({
      model: options.model ?? languageModelFor("skillWrite"),
      system: SKILL_SYSTEM_PROMPT,
      prompt,
      providerOptions: providerOptionsFor("skillWrite"),
      maxRetries: SKILL_WRITE_MAX_RETRIES,
      abortSignal: AbortSignal.timeout(SKILL_WRITE_TIMEOUT_MS),
    });
  } catch (error) {
    const failure = classify(error);
    console.warn(`[skills] write failed: tool=${toolId} kind=${failure.kind} transient=${failure.transient}`);
    if (failure.transient) return { status: "failed", toolId, reason: "model", kind: failure.kind, transient: true, recorded: false };
    await recordFailure(db, { toolId, inputHash, model: modelId, trigger: options.trigger, error: `The model could not answer (${failure.kind}).` });
    return { status: "failed", toolId, reason: "model", kind: failure.kind, transient: false, recorded: true };
  }

  const report = gatewayCallReport(result.providerMetadata);
  const inputTokens = result.totalUsage.inputTokens ?? 0;
  const outputTokens = result.totalUsage.outputTokens ?? 0;
  const parsed = parseSkillDraft(result.text);
  if (!parsed) {
    console.warn(`[skills] unreadable answer: tool=${toolId} tokens=${inputTokens}/${outputTokens} ${describeGatewayCall(report)}`);
    await recordFailure(db, {
      toolId,
      inputHash,
      model: modelId,
      trigger: options.trigger,
      costUsd: report.cost ?? 0,
      error: "The model's answer could not be read as a skill.",
    });
    return { status: "failed", toolId, reason: "unreadable", kind: null, transient: false, recorded: true };
  }

  const known = new Set(inputs.sources.map((source) => source.id));
  const guarded = guardSkillDraft(parsed.draft, known);
  if (draftSize(guarded.draft) === 0) {
    console.warn(`[skills] nothing survived the checks: tool=${toolId} removed=${guarded.removed.length} ${describeGatewayCall(report)}`);
    await recordFailure(db, {
      toolId,
      inputHash,
      model: modelId,
      trigger: options.trigger,
      costUsd: report.cost ?? 0,
      error: `Nothing the model wrote passed the checks (${guarded.removed.length} item(s) removed).`,
    });
    return { status: "failed", toolId, reason: "empty", kind: null, transient: false, recorded: true };
  }

  const stored = await storeSkill(db, inputs, guarded, { inputHash, model: modelId, trigger: options.trigger, costUsd: report.cost ?? 0 });
  const ms = Date.now() - started;
  console.info(
    `[skills] written: tool=${toolId} version=${stored.version} removed=${guarded.removed.length} unknown_cites=${guarded.unknownCites.length}` +
      ` tokens=${inputTokens}/${outputTokens} ${describeGatewayCall(report)} ms=${ms}`
  );
  return {
    status: "written",
    toolId,
    version: stored.version,
    inputTokens,
    outputTokens,
    cost: report.cost,
    removed: guarded.removed.length,
    model: modelId,
    ms,
  };
}

/** Compose, render and insert a ready row as the tool's next version. */
async function storeSkill(
  db: Db,
  inputs: SkillInputs,
  guarded: ReturnType<typeof guardSkillDraft>,
  row: { inputHash: string; model: string; trigger: ToolSkillTrigger; costUsd: number }
): Promise<{ version: number }> {
  const { sections, sources } = composeSkillSections(inputs, guarded);
  const generatedAt = new Date().toISOString();
  // The markdown names its version, which the insert's lock decides: it is
  // rendered inside that transaction, from the number the lock handed out.
  const stored = await insertToolSkill(db, {
    toolId: inputs.tool.id,
    status: "ready",
    contentFor: (version) =>
      renderSkillMarkdown({ toolName: inputs.tool.name, slug: inputs.tool.slug, version, generatedAt, model: row.model }, sections, sources),
    sections,
    sources,
    inputHash: row.inputHash,
    model: row.model,
    costUsd: row.costUsd,
    trigger: row.trigger,
  });
  return { version: stored.version };
}

/** Store a failed attempt (§5.3). Its reason is one plain line, never a prompt. */
export async function recordFailure(
  db: Db,
  row: { toolId: string; inputHash: string; model: string; trigger: ToolSkillTrigger; error: string; costUsd?: number }
): Promise<void> {
  await insertToolSkill(db, { ...row, status: "failed", error: row.error.slice(0, 300) });
}

/**
 * Store one failed row for a tool whose step gave up after its retries (the
 * workflow's catch): the hash of its inputs now, so the automatic pass does
 * not ask again for the same inputs. Never throws for a tool that is gone.
 */
export async function recordStepFailure(db: Db, toolId: string, trigger: ToolSkillTrigger, message: string): Promise<boolean> {
  const inputs = await assembleSkillInputs(db, toolId);
  if (!inputs) return false;
  const model = modelIdFor("skillWrite");
  await recordFailure(db, {
    toolId,
    inputHash: skillInputHash(inputs, { model, promptVersion: SKILL_PROMPT_VERSION }),
    model,
    trigger,
    error: message,
  });
  return true;
}

function classify(error: unknown): { kind: ModelErrorKind | "unknown"; transient: boolean } {
  const classified = classifyModelError(error);
  if (!classified) {
    const text = `${(error as { name?: string })?.name ?? ""} ${(error as { message?: string })?.message ?? ""}`;
    return { kind: "unknown", transient: /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network|timeout|abort/i.test(text) };
  }
  return { kind: classified.kind, transient: TRANSIENT_KINDS.includes(classified.kind) };
}

function labelOf(model: LanguageModel): string {
  return typeof model === "string" ? model : `${model.provider}/${model.modelId}`;
}
