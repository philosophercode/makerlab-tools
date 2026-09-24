/**
 * Resource link verification (spec §3.7 "Reused code", §8 "Link verification").
 *
 * Moved out of `capabilities/intake.ts` with its behaviour unchanged, because
 * background research needs it and a workflow step cannot reach into a
 * capability module. The rules are the same: a model fabricates plausible
 * URLs — invented YouTube ids above all — so every link is opened before it is
 * shown to anybody, and only a *definitive* "not found" drops it.
 *
 * Two things are new, both for the research step: it is generic over any
 * `{ title, url, type }` (the research result and the chat candidate share the
 * shape but not the type), and it takes a `signal` and a `maxLinks` cap so a
 * step with a 240-second budget cannot spend it opening links (the 2026-09-22
 * amendment).
 *
 * **Every non-YouTube link goes through `guardedFetch`** (gateway spec §8,
 * SSRF): the links come from a model that read untrusted pages, so a page
 * that lists `http://169.254.169.254/` as a "manual" must not make this server
 * request it. A refused address drops the link; redirects are checked hop by
 * hop, at most 3. Only the status matters, so the body is cut off after its
 * first byte.
 *
 * Relative imports only and no `"server-only"`: workflow step bundles load
 * this under plain Node.
 */

import { guardedFetch } from "../web/guarded-fetch.ts";

const VERIFY_UA = "Mozilla/5.0 (compatible; MakerLabBot/1.0)";
const VERIFY_TIMEOUT_MS = 8000;

/** How many links one call opens before it stops checking (§8: capped per item). */
export const DEFAULT_MAX_LINKS = 8;

/** The reason a link past {@link DEFAULT_MAX_LINKS} carries. */
export const NOT_CHECKED_REASON = "not checked (limit)";

export interface VerifyOptions {
  /**
   * The caller's own deadline. Each fetch still has its own 8-second timeout;
   * this one is the step's, and when it fires the call **throws** rather than
   * reporting every link unreachable — running out of time is not a verdict on
   * a manual that was never opened.
   */
  signal?: AbortSignal;
}

export interface VerifyLinksOptions extends VerifyOptions {
  /** Links beyond this many are dropped unopened. Default {@link DEFAULT_MAX_LINKS}. */
  maxLinks?: number;
}

function isYouTubeHost(host: string): boolean {
  const h = host.replace(/^www\./, "");
  return (
    h === "youtube.com" ||
    h === "m.youtube.com" ||
    h === "youtu.be" ||
    h.endsWith(".youtube.com")
  );
}

/** The per-request timeout, joined with the caller's deadline when there is one. */
function requestSignal(signal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(VERIFY_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Verify a single resource URL actually resolves to a real page/video, to catch
 * the model fabricating plausible-looking URLs (e.g. invented YouTube video ids).
 *
 * - YouTube: the oEmbed endpoint is authoritative — it returns 404 for a video
 *   id that does not exist (a normal `watch?v=` page returns HTTP 200 even for
 *   dead videos, so a status check alone is not enough).
 * - Everything else: a GET that only treats definitive "not found" signals
 *   (404/410, DNS/network failure, malformed URL) as invalid. 401/403/429/5xx
 *   are kept — they mean the resource exists but is gated or transiently
 *   erroring, and we'd rather not drop a real manual on a bot block.
 */
export async function verifyUrl(
  url: string,
  opts: VerifyOptions = {}
): Promise<{ ok: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "not an http(s) URL" };
  }

  opts.signal?.throwIfAborted();

  if (isYouTubeHost(parsed.hostname)) {
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: requestSignal(opts.signal) }
      );
      if (res.status === 200) return { ok: true };
      if (res.status === 404 || res.status === 401)
        return { ok: false, reason: "video does not exist" };
      return { ok: true }; // transient/unknown — don't false-drop
    } catch {
      opts.signal?.throwIfAborted();
      return { ok: false, reason: "video lookup failed" };
    }
  }

  const res = await guardedFetch(url, {
    signal: requestSignal(opts.signal),
    // Existence is the question, not the content: stop after the first byte.
    maxBytes: 1,
    userAgent: VERIFY_UA,
  });
  if (res.ok || res.reason === "too_large" || res.reason === "unsupported") return { ok: true };
  if (res.reason === "http_error") {
    if (res.status === 404 || res.status === 410) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true }; // gated, rate-limited or erroring — it exists
  }
  if (res.reason === "blocked") return { ok: false, reason: "refused (not a public web address)" };
  // "failed" or "timeout". The caller's deadline, not this link's: rethrow
  // instead of blaming the URL.
  opts.signal?.throwIfAborted();
  return { ok: false, reason: "unreachable" };
}

/**
 * Verify every resource link, preserving order. Returns the verified resources
 * (safe to surface/write) and a human-readable note for each dropped link so the
 * reviewer is told instead of the link silently vanishing.
 *
 * Links past `maxLinks` are not opened; they are dropped with
 * {@link NOT_CHECKED_REASON}, because an unverified link shown as verified is
 * the exact failure this module exists to prevent.
 */
export async function verifyResourceLinks<T extends { title: string; url: string; type: string }>(
  resources: T[],
  opts: VerifyLinksOptions = {}
): Promise<{ verified: T[]; dropped: string[] }> {
  const limit = Math.max(0, opts.maxLinks ?? DEFAULT_MAX_LINKS);
  const toCheck = resources.slice(0, limit);
  const unchecked = resources.slice(limit);

  const checked = await Promise.all(
    toCheck.map(async (r) => ({
      resource: r,
      result: await verifyUrl(r.url, { signal: opts.signal }),
    }))
  );

  const verified: T[] = [];
  const dropped: string[] = [];
  for (const { resource, result } of checked) {
    if (result.ok) {
      verified.push(resource);
    } else {
      dropped.push(describeDropped(resource, result.reason ?? "unverified"));
    }
  }
  for (const resource of unchecked) {
    dropped.push(describeDropped(resource, NOT_CHECKED_REASON));
  }
  return { verified, dropped };
}

function describeDropped(resource: { title: string; url: string; type: string }, reason: string): string {
  return `${resource.type} "${resource.title}" (${resource.url}) — ${reason}`;
}
