import type { ImageRetryState } from "../research/result.ts";
import { IMAGE_RETRY_STALE_MS } from "./limits.ts";

/**
 * Whether a **Find a different image** run is still going, as far as anybody
 * waiting on it should believe (amendment "reviewer notes").
 *
 * `running` and requested less than {@link IMAGE_RETRY_STALE_MS} ago. A run
 * still marked running after that has died without saying so — a deployment
 * mid-run, a start that never reached the workflow — and the page offers the
 * button again rather than spinning forever. The data layer applies the same
 * rule before it lets a new run start, so the two cannot disagree.
 *
 * Client-safe and plain Node.
 */
export function imageRetryInProgress(retry: ImageRetryState | null | undefined, now: number = Date.now()): boolean {
  if (!retry || retry.status !== "running") return false;
  const requested = Date.parse(retry.requestedAt);
  return Number.isFinite(requested) && now - requested < IMAGE_RETRY_STALE_MS;
}
