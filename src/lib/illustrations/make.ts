import { generateImage } from "ai";
import { classifyModelError } from "../ai/gateway-errors";
import { describeGatewayCall, gatewayCallReport } from "../ai/gateway-usage";
import { illustrationsEnabled, imageModelFor, MODEL_JOBS, modelIdFor } from "../ai/models";
import { getBlobStore, isBlobConfigured, type BlobStore } from "../blob";
import { failIllustration, finishIllustration, reserveIllustration } from "../data/chat-illustrations";
import type { IllustrationKind } from "../db/schema/vocabulary";
import type { Db } from "../db/types";
import { inspectImage } from "../images/inspect";
import {
  ILLUSTRATION_BLOB_PREFIX,
  ILLUSTRATION_DAILY_PER_PERSON,
  ILLUSTRATION_DEFAULT_MODEL_COST_USD,
  ILLUSTRATION_LAB_DAILY_BUDGET_USD,
  ILLUSTRATION_MAX_BYTES,
  ILLUSTRATION_SIZE,
  ILLUSTRATION_TIMEOUT_MS,
  ILLUSTRATION_UNKNOWN_MODEL_COST_USD,
  ILLUSTRATION_WINDOW_MS,
} from "./limits";
import { buildIllustrationPrompt, type PromptCatalogEntry } from "./prompt";

/**
 * One chat illustration, start to finish (gateway spec amendment 2026-10-07
 * "Generated illustrations in the chat"): the checks, the prompt, the place in
 * both caps, the model call, the stored picture and the ledger.
 *
 * In order, and nothing is paid for until every free check has passed:
 *
 * 1. **Switched on and somewhere to keep it** — `MODEL_ILLUSTRATION=off`
 *    answers `off`; no Blob store answers `unavailable` (never a paid call
 *    nobody can see the result of, as research's cleaning rule says).
 * 2. **A signed-in person** — the ledger is per person. The capability is
 *    offered only to people holding `chat.illustrate`, so this is the
 *    ledger's own precondition, not the gate.
 * 3. **Something to draw** — the prompt is built on the server from the plan
 *    or idea (`prompt.ts`); nothing left after cleaning answers
 *    `nothing_to_draw`.
 * 4. **A place in both caps** — `reserveIllustration`, under a lock.
 * 5. **The call** — `generateImage` on job `illustration`, one image, square,
 *    one retry, a 60-second deadline. Its cost is logged like every other
 *    job's (`[illustration] … cost $0.0100, tier not reported`).
 * 6. **The picture is checked** — PNG, JPEG or WebP by its own bytes, at most
 *    8 MB — and stored **private** under `chat/illustrations/`, then the row
 *    becomes `ready`. Anything failing on the way makes it `failed`, keeping
 *    the reported cost of a call that answered.
 *
 * The result names the image by its route, `/api/chat/illustrations/<id>`,
 * which serves it only to this person.
 */

export type IllustrationRefusal = "off" | "unavailable" | "sign_in" | "nothing_to_draw" | "person_limit" | "lab_budget" | "failed";

export type MakeIllustrationResult =
  | { ok: true; id: string; url: string; width: number; height: number; kind: IllustrationKind; costUsd: number }
  | { ok: false; reason: IllustrationRefusal };

export interface MakeIllustrationInput {
  userId: string | null | undefined;
  kind: IllustrationKind;
  description: string;
  /** The catalogue, so the lab's machines named in the plan are drawn as generic ones. */
  catalog: readonly PromptCatalogEntry[];
}

export interface MakeIllustrationDeps {
  db?: Db;
  store?: BlobStore;
  now?: Date;
  signal?: AbortSignal;
}

/** The image route for one illustration. */
export function illustrationUrl(id: string): string {
  return `/api/chat/illustrations/${id}`;
}

/** What one image is reserved at: the default model's known price, else the cautious one. */
export function estimatedCostFor(modelId: string): number {
  return modelId === MODEL_JOBS.illustration.default ? ILLUSTRATION_DEFAULT_MODEL_COST_USD : ILLUSTRATION_UNKNOWN_MODEL_COST_USD;
}

export async function makeIllustration(input: MakeIllustrationInput, deps: MakeIllustrationDeps = {}): Promise<MakeIllustrationResult> {
  if (!illustrationsEnabled()) return { ok: false, reason: "off" };
  if (!deps.store && !isBlobConfigured()) return { ok: false, reason: "unavailable" };
  if (!input.userId) return { ok: false, reason: "sign_in" };

  const built = buildIllustrationPrompt(input.kind, input.description, input.catalog);
  if (!built) return { ok: false, reason: "nothing_to_draw" };

  // A malformed MODEL_ILLUSTRATION is found here, before anything is reserved.
  // Its message names the variable, never the value.
  let modelId: string;
  try {
    modelId = modelIdFor("illustration");
  } catch (error) {
    console.warn(`[illustration] not configured: ${error instanceof Error ? error.message : "unknown error"}`);
    return { ok: false, reason: "failed" };
  }
  const estimate = estimatedCostFor(modelId);
  const reservation = await reserveIllustration(
    {
      userId: input.userId,
      kind: input.kind,
      model: modelId,
      estimatedCostUsd: estimate,
      perPersonLimit: ILLUSTRATION_DAILY_PER_PERSON,
      labBudgetUsd: ILLUSTRATION_LAB_DAILY_BUDGET_USD,
      windowMs: ILLUSTRATION_WINDOW_MS,
    },
    { db: deps.db, now: deps.now }
  );
  if (!reservation.ok) {
    console.info(`[illustration] refused: ${reservation.reason}`);
    return { ok: false, reason: reservation.reason };
  }
  const { id } = reservation;
  console.info(
    `[illustration] drawing ${input.kind} with ${modelId} (removed: ${built.removed.machineNames} machine names, ${built.removed.sentences} sentences, ${built.removed.links} links)`
  );

  let reportedCost: number | null = null;
  try {
    const signal = deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(ILLUSTRATION_TIMEOUT_MS)]) : AbortSignal.timeout(ILLUSTRATION_TIMEOUT_MS);
    const result = await generateImage({
      model: imageModelFor("illustration"),
      prompt: built.prompt,
      n: 1,
      size: ILLUSTRATION_SIZE,
      maxRetries: 1,
      abortSignal: signal,
    });
    const report = gatewayCallReport(result.providerMetadata);
    reportedCost = report.cost;
    console.info(`[illustration] ${input.kind} answered: ${describeGatewayCall(report)}`);

    const bytes = result.image.uint8Array;
    const info = bytes.byteLength <= ILLUSTRATION_MAX_BYTES ? inspectImage(bytes) : null;
    if (!info) {
      console.warn(`[illustration] ${id}: the model's answer is not a usable image (${bytes.byteLength} bytes)`);
      await failIllustration(id, reportedCost ?? 0, { db: deps.db });
      return { ok: false, reason: "failed" };
    }

    const store = deps.store ?? getBlobStore();
    const extension = info.format === "image/png" ? "png" : info.format === "image/webp" ? "webp" : "jpg";
    const file = new File([new Uint8Array(bytes)], `illustration.${extension}`, { type: info.format });
    const stored = await store.putUpload(ILLUSTRATION_BLOB_PREFIX, file, "private");

    const costUsd = reportedCost ?? estimate;
    await finishIllustration(
      id,
      { blobPathname: stored.pathname, contentType: info.format, width: info.width, height: info.height, costUsd },
      { db: deps.db }
    );
    return { ok: true, id, url: illustrationUrl(id), width: info.width, height: info.height, kind: input.kind, costUsd };
  } catch (error) {
    // The kind and status only: a Gateway error can carry the request, and the request is the prompt.
    const classified = classifyModelError(error);
    console.warn(
      `[illustration] ${id} failed: ${classified ? `${classified.kind}${classified.statusCode ? ` (${classified.statusCode})` : ""}` : error instanceof Error ? error.name : "unknown error"}`
    );
    await failIllustration(id, reportedCost ?? 0, { db: deps.db }).catch((err) => {
      console.error(`[illustration] ${id}: could not mark it failed`, err);
    });
    return { ok: false, reason: "failed" };
  }
}
