import type { PendingApiError, PendingApiErrorCode, ResearchStartedResponse } from "../intake/types";
import { chunkIds } from "./allowance.ts";
import { IMPORT_RESEARCH_CHUNK } from "./limits.ts";

/**
 * **Research selected (N)** for an import (bulk intake spec §3.1, §5 step 4):
 * the selection sent to the existing `POST /api/pending-tools/research` in
 * chunks of {@link IMPORT_RESEARCH_CHUNK} — its per-request limit — one after
 * the other, so every check that route makes (ownership, duplicates, the
 * allowance under its lock) is made for every chunk.
 *
 * **Nothing silently drops** (§10 "A 300-row sheet silently researches only
 * 100"). When the day's allowance is nearly spent, the route refuses a chunk
 * with `daily_limit` and says how many still fit; the queue sends exactly that
 * many and stops. Everything not sent is returned as `waiting` — "37 queued; 63
 * wait for tomorrow's allowance or a setup allowance" — and a chunk refused for
 * any other reason is returned with its code, and the rest carry on.
 *
 * **The route's press limit is waited out, not failed.** Research is limited
 * to ten presses a minute, and a 500-row import is twenty chunks; a
 * `rate_limited` answer waits its `Retry-After` and sends the same chunk again.
 *
 * Client-safe: the caller passes the request function (and, in tests, the
 * sleep), so the review table and the tests run exactly this.
 */

export type ResearchPostResult =
  | { ok: true; body: ResearchStartedResponse }
  | { ok: false; status: number; body: PendingApiError | null; retryAfterSeconds?: number };

export type ResearchPost = (ids: string[]) => Promise<ResearchPostResult>;

export interface ChunkProgress {
  /** 1-based. */
  chunk: number;
  chunks: number;
  queued: number;
  waiting: number;
}

export interface ChunkedResearchOutcome {
  queued: string[];
  readyAsUnit: string[];
  /** Not sent because the allowance ran out — in the order given. */
  waiting: string[];
  /** Chunks the route refused for another reason, with its code. */
  refused: { ids: string[]; code: PendingApiErrorCode | "failed" }[];
}

export interface QueueOptions {
  onProgress?: (progress: ChunkProgress) => void;
  sleep?: (ms: number) => Promise<void>;
  /** Times one chunk is sent again after `rate_limited` before it counts as refused. */
  maxRateLimitRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function queueResearchInChunks(
  ids: readonly string[],
  post: ResearchPost,
  options: QueueOptions = {}
): Promise<ChunkedResearchOutcome> {
  const sleep = options.sleep ?? defaultSleep;
  const maxRetries = options.maxRateLimitRetries ?? 6;
  const outcome: ChunkedResearchOutcome = { queued: [], readyAsUnit: [], waiting: [], refused: [] };
  const chunks = chunkIds([...new Set(ids)], IMPORT_RESEARCH_CHUNK);

  // One request, with the press limit waited out.
  const send = async (chunk: string[]): Promise<ResearchPostResult> => {
    for (let attempt = 0; ; attempt += 1) {
      const result = await post(chunk);
      if (result.ok || result.body?.code !== "rate_limited" || attempt >= maxRetries) return result;
      await sleep(Math.max(1, result.retryAfterSeconds ?? 10) * 1000);
    }
  };

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const result = await send(chunk);
    if (result.ok) {
      outcome.queued.push(...result.body.queued);
      outcome.readyAsUnit.push(...result.body.readyAsUnit);
    } else if (result.body?.code === "daily_limit") {
      const remaining = Math.max(0, Math.floor(result.body.remaining ?? 0));
      if (remaining > 0 && remaining < chunk.length) {
        // The allowance has room for some of this chunk: send exactly those.
        const partial = await send(chunk.slice(0, remaining));
        if (partial.ok) {
          outcome.queued.push(...partial.body.queued);
          outcome.readyAsUnit.push(...partial.body.readyAsUnit);
          outcome.waiting.push(...chunk.slice(remaining));
        } else {
          outcome.waiting.push(...chunk);
        }
      } else {
        outcome.waiting.push(...chunk);
      }
      for (const rest of chunks.slice(index + 1)) outcome.waiting.push(...rest);
      options.onProgress?.({ chunk: index + 1, chunks: chunks.length, queued: outcome.queued.length, waiting: outcome.waiting.length });
      break;
    } else {
      outcome.refused.push({ ids: chunk, code: result.body?.code ?? "failed" });
    }
    options.onProgress?.({ chunk: index + 1, chunks: chunks.length, queued: outcome.queued.length, waiting: outcome.waiting.length });
  }
  return outcome;
}

/** The research route over `fetch`, as {@link queueResearchInChunks} wants it. */
export const postResearch: ResearchPost = async (ids) => {
  try {
    const res = await fetch("/api/pending-tools/research", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    const body = (await res.json().catch(() => null)) as ResearchStartedResponse | PendingApiError | null;
    if (res.ok && body && "queued" in body) return { ok: true, body };
    const retryAfter = Number(res.headers.get("retry-after"));
    return {
      ok: false,
      status: res.status,
      body: body && "code" in body ? body : null,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    };
  } catch {
    return { ok: false, status: 0, body: null };
  }
};
