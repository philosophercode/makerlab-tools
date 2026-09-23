import { classifyModelError } from "../ai/gateway-errors.ts";
import { MODEL_JOBS } from "../ai/models.ts";
import { recordCleanedImage } from "../data/research-images.ts";
import type { Db } from "../db/types.ts";
import { createBlobUploader } from "../import/blob-uploader.ts";
import type { ImageHint } from "../web/read-page.ts";
import { scrub } from "./errors.ts";
import { makeCleanCopy } from "./images/clean-copy.ts";
import { probeCandidates } from "./images/probe.ts";
import { rankCandidates, type RankedImage } from "./images/rank.ts";
import { ModelOutputError } from "./model-output.ts";
import type { CleanNote, ResearchImages } from "./result.ts";

/**
 * The image stage's shared middle — probe, rank, clean rank 1 — and the
 * wording of its failures (gateway spec §3.5; amendment "Product-page first,
 * front-facing images, reviewer notes").
 *
 * Two steps run it: research's `findImages` (`image-steps.ts`) and the
 * image-only rerun, **Find a different image** (`image-retry-steps.ts`). It
 * lives in its own module, apart from both, because a workflow bundle keeps
 * whatever a step module *exports* that is not a step — and this touches the
 * network, Blob and the database, none of which a workflow function may reach.
 * Only step bodies import it.
 *
 * Plain Node: step code. Relative imports only.
 */

/** Where cleaned copies land in Blob. The store adds a random suffix. */
export const CLEANED_IMAGE_PREFIX = "research/cleaned/";

/** The longest `imageError` stored. */
export const IMAGE_ERROR_MAX_CHARS = 200;

const NO_CANDIDATES: ResearchImages = { candidates: [], cleaned: null };

/** What the stage came to: images, or why there are none. */
export interface StageOutcome {
  images: ResearchImages | null;
  imageError: string | null;
}

/**
 * Steps 3–5 of the stage over candidates already collected: probe, rank (with
 * the reviewer's instruction, when **Find a different image** carried one),
 * and clean rank 1. Shared by the research stage and the image-only rerun
 * (`image-retry-steps.ts`). Writes only the cleaned copy, never the result.
 */
export async function rankAndClean(
  db: Db,
  id: string,
  itemName: string,
  candidates: readonly ImageHint[],
  opts: { signal: AbortSignal; reviewerNote?: string | null }
): Promise<StageOutcome> {
  const { signal } = opts;
  if (candidates.length === 0) return { images: NO_CANDIDATES, imageError: null };

  const usable = (await probeCandidates([...candidates], { signal })).flatMap((probe) => (probe.ok ? [probe.image] : []));
  if (usable.length === 0) return { images: NO_CANDIDATES, imageError: null };

  let ranked: RankedImage[];
  try {
    ranked = await rankCandidates(itemName, usable, { signal, reviewerNote: opts.reviewerNote });
  } catch (error) {
    const message = expectedFailure(error, "Image ranking", MODEL_JOBS.imageRank.env);
    if (message === null) throw error;
    return { images: null, imageError: message };
  }

  const { cleaned, cleanNote } = await cleanTop(db, id, ranked[0]);
  return {
    images: {
      candidates: ranked.map((entry) => entry.candidate),
      cleaned,
      ...(cleanNote ? { cleanNote } : {}),
    },
    imageError: null,
  };
}

/**
 * The cleaned copy of rank 1, stored and recorded — or null, with a note when
 * a copy was expected and not made (`images/clean-copy.ts` decides which):
 *
 * - no Blob store: null, no note — nothing is cropped or cut;
 * - a product box and a reason to use it: the crop, cut too when its backdrop
 *   is plain (`kind: "cropped_and_cut"`), or kept alone (`kind: "cropped"`,
 *   with the note saying why the backdrop stayed);
 * - otherwise a `plain` rank 1 is cut (no `kind`: a plain cut, as before);
 *   `busy` is null with `busy_background`; `transparent` or unclassified is
 *   null with no note; a cut that failed its checks is null with its note;
 * - a Blob write that failed: null, no note (retrying the whole stage would
 *   pay for the ranking again, for a copy nobody has to choose).
 *
 * A database failure recording it is not caught.
 */
async function cleanTop(
  db: Db,
  id: string,
  top: RankedImage | undefined
): Promise<{ cleaned: ResearchImages["cleaned"]; cleanNote: CleanNote | null }> {
  const none = { cleaned: null, cleanNote: null };
  if (!top) return none;
  const uploader = createBlobUploader();
  if (!uploader) return none;

  const copy = await makeCleanCopy({
    bytes: top.image.bytes,
    background: top.image.background,
    composite: top.composite,
    productBox: top.productBox,
  });
  if (!copy.made) {
    if (copy.note && copy.note !== "busy_background") console.warn(`[research] the background cutout was not kept: ${copy.note}`);
    return { cleaned: null, cleanNote: copy.note };
  }
  if (copy.kind === "cropped") console.info(`[research] rank 1 cropped to its product; backdrop kept (${copy.note ?? "not plain"})`);

  let stored: { pathname: string };
  try {
    stored = await uploader.put(`${CLEANED_IMAGE_PREFIX}${id}.png`, copy.bytes, {
      access: "private",
      contentType: "image/png",
    });
  } catch (error) {
    console.warn(`[research] the cleaned image could not be stored (${errorName(error)})`);
    return none;
  }

  const attachmentId = await recordCleanedImage(db, {
    pendingId: id,
    blobPathname: stored.pathname,
    sizeBytes: copy.bytes.byteLength,
    width: copy.info.width,
    height: copy.info.height,
    fromUrl: top.candidate.url,
  });
  return {
    cleaned: { attachmentId, fromUrl: top.candidate.url, ...(copy.kind === "cut" ? {} : { kind: copy.kind }) },
    cleanNote: copy.note,
  };
}

/**
 * The `imageError` for a failure the stage expects — an answer that does not
 * parse, or a model call that failed — or null for anything else. Worded in the
 * app's terms, naming the variable to fix for a configuration error.
 */
export function expectedFailure(error: unknown, label: string, envVar: string): string | null {
  if (error instanceof ModelOutputError) return `${label}: the model's answer could not be read.`;

  const model = classifyModelError(error);
  if (!model) return null;
  const http = model.statusCode === null ? "" : ` (HTTP ${model.statusCode})`;
  switch (model.kind) {
    case "model_config":
      return `${label}: model not available (${model.envVar ?? envVar}).`;
    case "model_not_found":
      return `${label}: model not available (${envVar}).`;
    case "auth":
      return `${label}: the AI Gateway is not authenticated.`;
    case "rate_limited":
      return `${label}: the model provider is rate limiting${http}.`;
    case "provider_unavailable":
      return `${label}: the model provider is unavailable${http}.`;
    case "invalid_request":
      return `${label}: the model provider refused the request${http}.`;
    case "timeout":
      return `${label}: timed out.`;
  }
}

/** One line, no links, nothing key-shaped, at most {@link IMAGE_ERROR_MAX_CHARS}. */
export function imageErrorText(reason: string): string {
  const line = scrub(reason)
    .replace(/\b(?:https?|ftp|file|data):\S*/gi, "[link]")
    .replace(/\s+/g, " ")
    .trim();
  if (!line) return "The image search failed.";
  return line.length > IMAGE_ERROR_MAX_CHARS ? `${line.slice(0, IMAGE_ERROR_MAX_CHARS - 1)}…` : line;
}

export function errorName(error: unknown): string {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : null;
  return typeof name === "string" && /^[A-Za-z_$][\w$]*$/.test(name) ? name : "unknown error";
}
