/**
 * The chat's manual PDFs, base64-encoded, kept in memory for a few minutes
 * (performance plan, "Stop re-fetching and re-sending manual PDFs on every
 * turn"). A student on a tool page whose manual is not processed yet sends a
 * message, then another: without this, every turn downloaded the same PDF
 * again before the answer could start.
 *
 * - Per server instance, in memory: a cold instance fetches once, as before.
 * - Only successes are kept, so a manual host's bad minute is retried on the
 *   next turn.
 * - Concurrent turns share one in-flight fetch per URL.
 * - Bounded by entry age and by total size, so a busy instance cannot hold
 *   more than {@link MAX_CACHED_CHARS} of base64.
 *
 * Tests reset it with {@link clearManualPdfCache}.
 */

const TTL_MS = 10 * 60 * 1000;
/** About 40 MB of base64 — four manuals at the chat's 10 MB per-file cap. */
const MAX_CACHED_CHARS = 40 * 1024 * 1024;

interface Entry {
  data: string;
  expires: number;
}

const settled = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string | null>>();

function cachedChars(): number {
  let total = 0;
  for (const entry of settled.values()) total += entry.data.length;
  return total;
}

function remember(url: string, data: string, now: number): void {
  if (data.length > MAX_CACHED_CHARS) return;
  settled.delete(url);
  // Oldest first (Map keeps insertion order): drop until the new one fits.
  while (settled.size > 0 && cachedChars() + data.length > MAX_CACHED_CHARS) {
    const oldest = settled.keys().next().value as string;
    settled.delete(oldest);
  }
  settled.set(url, { data, expires: now + TTL_MS });
}

/**
 * The base64 bytes for `url`: from memory when fetched in the last
 * {@link TTL_MS}, else from `load` (null on failure, and not remembered).
 */
export async function cachedManualPdf(url: string, load: () => Promise<string | null>): Promise<string | null> {
  const now = Date.now();
  const hit = settled.get(url);
  if (hit && hit.expires > now) return hit.data;
  if (hit) settled.delete(url);

  const pending = inFlight.get(url);
  if (pending) return pending;

  const promise = load()
    .then((data) => {
      if (data) remember(url, data, Date.now());
      return data;
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, promise);
  return promise;
}

/** Forget everything — for tests, which reuse URLs across cases. */
export function clearManualPdfCache(): void {
  settled.clear();
  inFlight.clear();
}
