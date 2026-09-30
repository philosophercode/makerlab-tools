import { inspectImage, type ImageInfo } from "../../images/inspect.ts";
import { IMAGE_MAX_BYTES, IMAGE_MIN_SHORT_EDGE } from "../../intake/limits.ts";
import { guardedFetch } from "../../web/guarded-fetch.ts";
import type { ImageHint } from "../../web/read-page.ts";
import type { BackgroundClass } from "../result.ts";
import { classifyBackground } from "./background.ts";
import type { SharpLoader } from "./downscale.ts";

/**
 * Step 2 of the image stage (gateway spec §3.5): download each candidate and
 * keep only what is really a usable photo.
 *
 * - **Through the SSRF guard.** Every candidate URL came from a page or a search
 *   result, so it is fetched with `guardedFetch` — http(s) only, private and
 *   metadata addresses refused at every redirect, at most `IMAGE_MAX_BYTES`
 *   (8 MB) and `PROBE_TIMEOUT_MS` per image.
 * - **The bytes decide, not the headers.** A CDN that says
 *   `application/octet-stream` for a JPEG is common, so the content type is
 *   ignored and `inspectImage` must read a JPEG, PNG or WebP header with a
 *   short edge of at least `IMAGE_MIN_SHORT_EDGE` (400 px).
 * - **Bytes stay in memory and are never stored** (§3.5): ranking reads them
 *   and the step drops them. The only file written before a person decides is
 *   the cleaned copy.
 * - **Classified while it is in hand.** A kept image's background is read from
 *   its border pixels (`background.ts`): `transparent`, `plain` or `busy`, or
 *   null when it cannot be told. Ranking prefers the clean ones, and only a
 *   `plain` rank 1 is cut out.
 * - **Three at a time** (Article 4: bounded fan-out), results in input order.
 *
 * A rejection is a value with a short reason, never a throw. Plain Node: step
 * code imports this.
 */

/** One image's budget, inside the step's own 240 s. */
export const PROBE_TIMEOUT_MS = 15_000;

/** Candidates fetched at once. */
export const PROBE_CONCURRENCY = 3;

const ACCEPT = "image/webp,image/png,image/jpeg;q=0.9,image/*;q=0.5";

export interface ProbedImage {
  hint: ImageHint;
  bytes: Uint8Array;
  info: ImageInfo;
  /** What surrounds the product, or null when the pixels could not be read. */
  background: BackgroundClass | null;
}

export type ProbeRejection =
  | "blocked"
  | "failed"
  | "too_large"
  | "http_error"
  | "timeout"
  | "unsupported"
  | "not_an_image"
  | "too_small";

export type ProbeResult =
  | { ok: true; image: ProbedImage }
  | { ok: false; hint: ImageHint; reason: ProbeRejection; detail?: string };

export async function probeCandidate(
  hint: ImageHint,
  opts: { signal: AbortSignal; loadSharp?: SharpLoader }
): Promise<ProbeResult> {
  const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
  const fetched = await guardedFetch(hint.url, { signal, maxBytes: IMAGE_MAX_BYTES, accept: ACCEPT });
  if (!fetched.ok) {
    return { ok: false, hint, reason: fetched.reason, ...(fetched.detail ? { detail: fetched.detail } : {}) };
  }

  const info = inspectImage(fetched.bytes);
  if (!info) return { ok: false, hint, reason: "not_an_image" };
  if (Math.min(info.width, info.height) < IMAGE_MIN_SHORT_EDGE) {
    return { ok: false, hint, reason: "too_small", detail: `${info.width}x${info.height}` };
  }
  const background = await classifyBackground(fetched.bytes, { loadSharp: opts.loadSharp });
  return { ok: true, image: { hint, bytes: fetched.bytes, info, background } };
}

/** {@link probeCandidate} over `hints`, `concurrency` at a time, answers in the order given. */
export async function probeCandidates(
  hints: readonly ImageHint[],
  opts: { signal: AbortSignal; concurrency?: number; loadSharp?: SharpLoader }
): Promise<ProbeResult[]> {
  const results = new Array<ProbeResult>(hints.length);
  let next = 0;
  const worker = async () => {
    while (next < hints.length) {
      const index = next;
      next += 1;
      results[index] = await probeCandidate(hints[index], opts);
    }
  };
  const width = Math.max(1, Math.min(opts.concurrency ?? PROBE_CONCURRENCY, hints.length));
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
