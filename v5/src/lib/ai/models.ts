import { createGateway, type GatewayProvider } from "@ai-sdk/gateway";

/**
 * The job registry (gateway spec §3.1): every model call the app makes names a
 * *job*, and this table is the one place a job becomes a model.
 *
 * - **Gateway only.** Every job resolves to a Vercel AI Gateway model. There is
 *   no second provider and no key for one; `ANTHROPIC_API_KEY` is read by
 *   nothing.
 * - **Defaults in code, overrides by env.** Each job has a default id and one
 *   `MODEL_<JOB>` variable that replaces it. The override is read **at call
 *   time**, so a test (or a redeploy) that changes it is seen by the next call,
 *   and a blank value means "use the default" — a variable declared but left
 *   empty in a dashboard is the common misconfiguration.
 * - **A malformed override is a configuration error, not a model call.** It
 *   throws {@link ModelConfigError} naming the variable — never its value: the
 *   value is whatever somebody pasted, and a key pasted into the wrong box must
 *   not end up in a log line.
 *
 * **Plain Node on purpose.** Research steps import this file from a workflow
 * bundle that loads packages at runtime, where `"server-only"` throws; so no
 * `"server-only"` here or below, relative imports only. Constructing a model is
 * pure — `@ai-sdk/gateway` makes no request until the model is called — which
 * is what keeps every test that builds one offline (Article 3).
 *
 * **Authentication** is the provider's own: `AI_GATEWAY_API_KEY` when set,
 * otherwise the deployment's OIDC token (`VERCEL_OIDC_TOKEN`). Production needs
 * no AI key at all.
 */

/**
 * Every job, chat included, is on Luna. Chat first missed the §10 eval gate on
 * Luna (2026-09-23 amendment "The chat eval gate": it never named the Trotec
 * SOP) and ran on `anthropic/claude-sonnet-5`. The chat prompt was then tuned
 * (amendment "Chat prompt tuning for Luna") — name a resource by its exact
 * title, and route repair questions to `get_maintenance_history` — and Luna
 * passed the gate on three runs, so chat moved to it. `MODEL_CHAT` switches it
 * back without a deploy.
 */
/*
 * **Service tier** (amendment "Manuals as text and flex tier for research"):
 * each job also names the Gateway service tier its calls ask for, whichever
 * model is set — `"flex"` for the background jobs, where a slower, cheaper
 * answer costs nobody a wait, and `"default"` (no hint at all) for chat, which a
 * person is waiting on. `MODEL_<JOB>_TIER` (`default` | `flex` | `priority`)
 * overrides it. It is a best-effort hint: a provider without the tier ignores
 * it. {@link providerOptionsFor} turns it into the call's `providerOptions`.
 */
export const MODEL_JOBS = {
  chat: {
    kind: "language",
    env: "MODEL_CHAT",
    default: "openai/gpt-6-luna",
    serviceTier: "default",
    tierEnv: "MODEL_CHAT_TIER",
  },
  researchSearch: {
    kind: "language",
    env: "MODEL_RESEARCH_SEARCH",
    default: "openai/gpt-6-luna",
    serviceTier: "flex",
    tierEnv: "MODEL_RESEARCH_SEARCH_TIER",
  },
  // Also the starter-question backfill's job (`scripts/generate-starter-questions.ts`).
  researchRead: {
    kind: "language",
    env: "MODEL_RESEARCH_READ",
    default: "openai/gpt-6-luna",
    serviceTier: "flex",
    tierEnv: "MODEL_RESEARCH_READ_TIER",
  },
  imageRank: {
    kind: "language",
    env: "MODEL_IMAGE_RANK",
    default: "openai/gpt-6-luna",
    serviceTier: "flex",
    tierEnv: "MODEL_IMAGE_RANK_TIER",
  },
  // Bulk intake (bulk intake spec §3.2): reading an imported document into
  // items — no tools, no web search, the text fenced as untrusted data.
  // Background work in a workflow, so flex.
  importParse: {
    kind: "language",
    env: "MODEL_IMPORT_PARSE",
    default: "openai/gpt-6-luna",
    serviceTier: "flex",
    tierEnv: "MODEL_IMPORT_PARSE_TIER",
  },
  // Bulk intake's optional Suggest names pass (§3.3): one Exa search and one
  // small answer per item, in a workflow — flex.
  nameSuggest: {
    kind: "language",
    env: "MODEL_NAME_SUGGEST",
    default: "openai/gpt-6-luna",
    serviceTier: "flex",
    tierEnv: "MODEL_NAME_SUGGEST_TIER",
  },
  // Manual passages and search queries (manual text spec §3.4). An embedding
  // job, not a language one: `embeddingModelFor`, never `languageModelFor`.
  // No tier hint — embeddings are cheap and a search is waited on.
  embed: {
    kind: "embedding",
    env: "MODEL_EMBED",
    default: "openai/text-embedding-3-small",
    serviceTier: "default",
    tierEnv: "MODEL_EMBED_TIER",
  },
  // No image job: the `imageClean` redraw (gpt-image-1-mini) was retired on
  // 2026-09-23 — it altered product labels. Background removal is now a
  // deterministic cutout (`research/images/clean.ts`) that calls no model.
} as const;

export type ModelJob = keyof typeof MODEL_JOBS;
/** The jobs that resolve to a language model (every one but `embed`). */
export type LanguageJob = {
  [K in ModelJob]: (typeof MODEL_JOBS)[K]["kind"] extends "language" ? K : never;
}[ModelJob];
/** The jobs that resolve to an embedding model. */
export type EmbeddingJob = {
  [K in ModelJob]: (typeof MODEL_JOBS)[K]["kind"] extends "embedding" ? K : never;
}[ModelJob];

/** What a language job resolves to — the provider-neutral V3 model interface. */
type LanguageModelV3 = ReturnType<GatewayProvider["languageModel"]>;
/** What an embedding job resolves to. */
export type EmbeddingModelV3 = ReturnType<GatewayProvider["embeddingModel"]>;

/**
 * The dimension every stored manual embedding has (manual text spec §3.4, §4):
 * `vector(512)` in migration 0011. Asked of the model on every call, so a
 * `MODEL_EMBED` that can shorten its vectors (OpenAI's `text-embedding-3-*`,
 * Voyage) fits the column; one that cannot fails the write, loudly.
 */
export const EMBEDDING_DIMENSIONS = 512;

/** `provider/model` — the only shape the Gateway accepts. Anything else is a config error. */
export const GATEWAY_MODEL_ID_PATTERN = /^[a-z0-9-]+\/[a-z0-9.-]+$/;

/**
 * The test/E2E-only override of the Gateway's base URL, like
 * `NOTION_API_BASE_URL`. It is the **full** base, `/v3/ai` included
 * (`https://ai-gateway.vercel.sh/v3/ai` is the provider's default).
 * Production never sets it.
 */
export const GATEWAY_BASE_URL_ENV = "AI_GATEWAY_BASE_URL";

const MARKER = Symbol.for("makerlab.ai.ModelConfigError");

/**
 * A job's model cannot be resolved from configuration: an unknown job, or an
 * override that is not a Gateway id. Never retried — the same configuration
 * fails the same way — and the message names the variable, never its value.
 */
export class ModelConfigError extends Error {
  override name = "ModelConfigError";
  /** The variable to fix, or null when the problem is not an env var (an unknown job). */
  readonly envVar: string | null;
  /** The job that failed to resolve (or `"custom"` for {@link gatewayLanguageModel}). */
  readonly job: string;
  readonly [MARKER] = true;

  constructor(message: string, details: { job: string; envVar: string | null }) {
    super(message);
    this.job = details.job;
    this.envVar = details.envVar;
  }

  /**
   * `instanceof` without the class identity: the workflow step bundle inlines
   * its own copy of this module, so an error thrown there is not an instance of
   * the class a route imported.
   */
  static isInstance(error: unknown): error is ModelConfigError {
    return typeof error === "object" && error !== null && MARKER in error;
  }
}

function jobSpec(job: ModelJob) {
  const spec = Object.hasOwn(MODEL_JOBS, job) ? MODEL_JOBS[job] : undefined;
  if (!spec) {
    throw new ModelConfigError(`Unknown model job "${String(job)}".`, {
      job: String(job),
      envVar: null,
    });
  }
  return spec;
}

/**
 * The Gateway model id for `job`: its `MODEL_<JOB>` override when that is set
 * and not blank, else the default. Throws {@link ModelConfigError} for an
 * unknown job or a malformed override.
 */
export function modelIdFor(job: ModelJob): string {
  const spec = jobSpec(job);
  const override = process.env[spec.env]?.trim();
  if (!override) return spec.default;
  if (!GATEWAY_MODEL_ID_PATTERN.test(override)) {
    throw new ModelConfigError(
      `${spec.env} is not a Gateway model id (expected "provider/model", lower case).`,
      { job, envVar: spec.env }
    );
  }
  return override;
}

/** A job's service tier setting: `"default"` sends no hint. */
export type ServiceTierSetting = "default" | "flex" | "priority";

/** The tier the Gateway is asked for — {@link ServiceTierSetting} without `"default"`. */
export type GatewayServiceTier = Exclude<ServiceTierSetting, "default">;

const SERVICE_TIER_SETTINGS: readonly ServiceTierSetting[] = ["default", "flex", "priority"];

/**
 * The service tier `job`'s calls ask the Gateway for: its `MODEL_<JOB>_TIER`
 * override when set and not blank (any case), else the job's own setting. Null
 * for `"default"` — no hint is sent. Throws {@link ModelConfigError}, naming
 * the variable and never its value, for anything but `default`, `flex` or
 * `priority`.
 */
export function serviceTierFor(job: ModelJob): GatewayServiceTier | null {
  const spec = jobSpec(job);
  const override = process.env[spec.tierEnv]?.trim().toLowerCase();
  let setting: ServiceTierSetting = spec.serviceTier;
  if (override) {
    if (!(SERVICE_TIER_SETTINGS as readonly string[]).includes(override)) {
      throw new ModelConfigError(`${spec.tierEnv} is not a service tier (expected "default", "flex" or "priority").`, {
        job,
        envVar: spec.tierEnv,
      });
    }
    setting = override as ServiceTierSetting;
  }
  return setting === "default" ? null : setting;
}

/**
 * The `providerOptions` a call for `job` passes: `{ gateway: { serviceTier } }`
 * when the job asks for a tier, else undefined — so chat, on `"default"`, sends
 * no provider options at all.
 */
export function providerOptionsFor(job: ModelJob): { gateway: { serviceTier: GatewayServiceTier } } | undefined {
  const tier = serviceTierFor(job);
  return tier ? { gateway: { serviceTier: tier } } : undefined;
}

/** The language model for `job`, through the Gateway. */
export function languageModelFor(job: LanguageJob): LanguageModelV3 {
  const spec = jobSpec(job);
  if (spec.kind !== "language") {
    throw new ModelConfigError(`Model job "${job}" is not a language job.`, { job, envVar: null });
  }
  return gatewayProvider()(modelIdFor(job));
}

/** The embedding model for `job` (only `embed` today), through the Gateway. */
export function embeddingModelFor(job: EmbeddingJob = "embed"): EmbeddingModelV3 {
  const spec = jobSpec(job);
  if (spec.kind !== "embedding") {
    throw new ModelConfigError(`Model job "${job}" is not an embedding job.`, { job, envVar: null });
  }
  return gatewayProvider().embeddingModel(modelIdFor(job));
}

/**
 * What a stored embedding records as its model (`manual_documents.embedding_model`):
 * `openai/text-embedding-3-small@512`. A document whose value differs is
 * re-embedded, so changing `MODEL_EMBED` rolls out through the backfill.
 */
export function embeddingModelKey(job: EmbeddingJob = "embed"): string {
  return `${modelIdFor(job)}@${EMBEDDING_DIMENSIONS}`;
}

/**
 * The `providerOptions` that ask the embedding model `modelId` for
 * {@link EMBEDDING_DIMENSIONS}-dimension vectors. The Gateway passes a
 * provider's own options through under its name: OpenAI calls it
 * `dimensions`, Voyage `outputDimension`. Any other provider gets none, and
 * a vector of the wrong size is refused by the column.
 */
export function embeddingProviderOptions(
  modelId: string,
  dimensions: number = EMBEDDING_DIMENSIONS
): Record<string, Record<string, number>> | undefined {
  const provider = modelId.split("/")[0];
  if (provider === "openai") return { openai: { dimensions } };
  if (provider === "voyage") return { voyage: { outputDimension: dimensions } };
  return undefined;
}

/**
 * A language model by explicit Gateway id — for `EVAL_MODEL`, which names a
 * model outside the job table. Validated like an override; `envVar` is what the
 * error names when it is not.
 */
export function gatewayLanguageModel(modelId: string, envVar?: string): LanguageModelV3 {
  const id = modelId.trim();
  if (!GATEWAY_MODEL_ID_PATTERN.test(id)) {
    throw new ModelConfigError(
      `${envVar ?? "The model id"} is not a Gateway model id (expected "provider/model", lower case).`,
      { job: "custom", envVar: envVar ?? null }
    );
  }
  return gatewayProvider()(id);
}

const providers = new Map<string, GatewayProvider>();

/**
 * The Gateway provider, memoised per base URL so a test that points
 * `AI_GATEWAY_BASE_URL` somewhere else gets a provider for that place. The
 * credentials are not part of the key: the provider reads them on every request.
 */
export function gatewayProvider(): GatewayProvider {
  const raw = process.env[GATEWAY_BASE_URL_ENV]?.trim() || undefined;
  if (raw !== undefined && !/^https?:\/\/[^\s]+$/i.test(raw)) {
    throw new ModelConfigError(`${GATEWAY_BASE_URL_ENV} is not an http(s) URL.`, {
      job: "gateway",
      envVar: GATEWAY_BASE_URL_ENV,
    });
  }
  const key = raw ?? "";
  let provider = providers.get(key);
  if (!provider) {
    provider = createGateway({ baseURL: raw });
    providers.set(key, provider);
  }
  return provider;
}
