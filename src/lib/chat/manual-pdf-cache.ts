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

/**
 * What is kept for one URL: the base64 bytes, alone or with facts read from
 * them once (the route keeps the page count beside them).
 */
export type CachedValue = string | { data: string };

interface Entry {
  value: CachedValue;
  expires: number;
}

const settled = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedValue | null>>();

function sizeOf(value: CachedValue): number {
  return typeof value === "string" ? value.length : value.data.length;
}

function cachedChars(): number {
  let total = 0;
  for (const entry of settled.values()) total += sizeOf(entry.value);
  return total;
}

function remember(url: string, value: CachedValue, now: number): void {
  const size = sizeOf(value);
  if (size > MAX_CACHED_CHARS) return;
  settled.delete(url);
  // Oldest first (Map keeps insertion order): drop until the new one fits.
  while (settled.size > 0 && cachedChars() + size > MAX_CACHED_CHARS) {
    const oldest = settled.keys().next().value as string;
    settled.delete(oldest);
  }
  settled.set(url, { value, expires: now + TTL_MS });
}

/**
 * The base64 bytes for `url` (or the value carrying them): from memory when
 * fetched in the last {@link TTL_MS}, else from `load` (null on failure, and
 * not remembered). One URL is always loaded with the same kind of value.
 */
export async function cachedManualPdf<T extends CachedValue>(url: string, load: () => Promise<T | null>): Promise<T | null> {
  const now = Date.now();
  const hit = settled.get(url);
  if (hit && hit.expires > now) return hit.value as T;
  if (hit) settled.delete(url);

  const pending = inFlight.get(url);
  if (pending) return pending as Promise<T | null>;

  const promise = load()
    .then((value) => {
      if (value) remember(url, value, Date.now());
      return value;
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
