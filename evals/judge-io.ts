import { generateText, type LanguageModel, type ToolSet } from "ai";
import sharp from "sharp";
import { gatewayCallReport } from "@/lib/ai/gateway-usage";
import { gatewayLanguageModel, languageModelFor, modelIdFor, providerOptionsFor } from "@/lib/ai/models";
import { IMAGE_MAX_BYTES } from "@/lib/intake/limits";
import { guardedFetch } from "@/lib/web/guarded-fetch";

/**
 * What the paid evals' judges share (the photo-quality eval and the ideal-lab
 * eval): the judge model, one judged call with its Gateway cost, and pictures
 * downloaded and shrunk for judging. Network and model only; the grading
 * itself lives beside each eval and is tested offline.
 */

/**
 * The judge: job `evalQuestions` (Opus, the model that writes from the
 * manuals), or `EVAL_JUDGE_MODEL` — an explicit Gateway id — to try another.
 * A run's scores are only comparable with runs judged by the same model, so
 * reports record {@link judgeModelId}.
 */
export function judgeModel(): LanguageModel {
  const override = process.env.EVAL_JUDGE_MODEL?.trim();
  return override ? gatewayLanguageModel(override, "EVAL_JUDGE_MODEL") : languageModelFor("evalQuestions");
}

export function judgeModelId(): string {
  return process.env.EVAL_JUDGE_MODEL?.trim() || modelIdFor("evalQuestions");
}

let warnedNoCost = false;

function marketCost(metadata: unknown): number {
  const gateway = (metadata as { gateway?: { marketCost?: unknown } } | undefined)?.gateway;
  const value = Number(gateway?.marketCost);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** One judge call: text and pictures in, its reply and what the Gateway said it cost. */
export async function judgeCall(
  system: string,
  prompt: string,
  images: readonly Uint8Array[] = [],
  opts: { tools?: ToolSet; timeoutMs?: number } = {}
): Promise<{ text: string; cost: number }> {
  const result = await generateText({
    model: judgeModel(),
    system,
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({ type: "image" as const, image, mediaType: "image/png" })),
          { type: "text" as const, text: prompt },
        ],
      },
    ],
    ...(opts.tools ? { tools: opts.tools } : {}),
    providerOptions: process.env.EVAL_JUDGE_MODEL ? undefined : providerOptionsFor("evalQuestions"),
    maxRetries: 2,
    abortSignal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  // Per step when the Gateway reports it there; else the call's own metadata. A call
  // billed to the account's own provider key (BYOK) reports cost 0 and its list price
  // as `marketCost`: that is what the judge would cost anyone else, so it is counted.
  const priced = (metadata: unknown) => gatewayCallReport(metadata).cost || marketCost(metadata);
  const perStep = result.steps.reduce((total, step) => total + priced(step.providerMetadata), 0);
  const cost = perStep > 0 ? perStep : priced(result.providerMetadata);
  if (cost === 0 && !warnedNoCost) {
    // Once a run: what the Gateway sent instead, so an unreported cost can be traced (keys only, no values).
    warnedNoCost = true;
    const gateway = result.providerMetadata?.gateway;
    console.warn(`[judge] no cost reported; provider metadata keys: ${Object.keys(result.providerMetadata ?? {}).join(", ") || "(none)"}; gateway keys: ${gateway ? Object.keys(gateway).join(", ") : "(none)"}`);
  }
  return { text: result.text, cost };
}

export const JUDGE_SIDE = 768;

/** The picture as a PNG at most {@link JUDGE_SIDE} wide or tall: cheaper to judge, and one format. */
export async function forJudge(bytes: Uint8Array, background?: string): Promise<Uint8Array> {
  let image = sharp(bytes).rotate().resize(JUDGE_SIDE, JUDGE_SIDE, { fit: "inside", withoutEnlargement: true });
  if (background) image = image.flatten({ background });
  return new Uint8Array(await image.png().toBuffer());
}

/** A picture through the app's SSRF-guarded fetch, as research downloads them. */
export async function downloadImage(url: string): Promise<{ bytes: Uint8Array } | { error: string }> {
  const fetched = await guardedFetch(url, {
    signal: AbortSignal.timeout(20_000),
    maxBytes: IMAGE_MAX_BYTES,
    accept: "image/jpeg, image/png, image/webp",
  });
  if (!fetched.ok) return { error: `download: ${fetched.reason}` };
  return { bytes: fetched.bytes };
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
};
