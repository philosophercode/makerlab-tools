import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isForbiddenAddress } from "./address-guard.ts";

/**
 * A GET that is safe to point at a URL a model proposed (gateway spec §3.3,
 * §8 SSRF).
 *
 * - **http(s) only.** Every other scheme is refused before anything happens.
 * - **The address is checked, not the name.** The host is resolved and every
 *   address it resolves to must pass {@link isForbiddenAddress}; a literal IP is
 *   checked as it stands, with no resolution.
 * - **Redirects are followed by hand** (`redirect: "manual"`), at most
 *   `maxRedirects` (3), and every hop is checked again — scheme, `allowedHosts`
 *   and address — so a public page cannot bounce the request inward.
 * - **The body is streamed and cut off** at `maxBytes`; a response that says it
 *   is bigger is refused on its headers.
 * - **Expected failures are values**, never throws: a caller in a research step
 *   records the reason and moves on to the next page.
 *
 * **Known limitation: DNS rebinding.** The name is resolved here and then again
 * by `fetch`, with no pinned socket between them, so a host whose DNS answers a
 * public address to the check and a private one to the connection gets through.
 * Closing that needs a custom dispatcher pinned to the checked address; the
 * exposure is a model-proposed URL on a host an attacker controls, answered by
 * a GET whose body only a model reads.
 *
 * **Test seams.** Resolution goes through
 * `globalThis[Symbol.for("makerlab.web.resolveHost")]` when that is a function —
 * Vitest's setup installs one so no test touches DNS, and it lives on
 * `globalThis` so the workflow step bundle sees it too. Production never sets
 * it. `READ_PAGE_TEST_ORIGIN` (one exact origin, e.g. `http://localhost:3101`)
 * skips the address check for that origin only, so the E2E stub server can be
 * read; it is ignored whenever `VERCEL` is set.
 *
 * Plain Node: step code imports this.
 */

export type GuardedFetchResult =
  | {
      ok: true;
      url: string;
      status: number;
      contentType: string | null;
      bytes: Uint8Array;
      /** The final response's headers (after any redirects). */
      headers: Headers;
    }
  | {
      ok: false;
      url: string;
      reason: "blocked" | "failed" | "too_large" | "http_error" | "timeout" | "unsupported";
      status?: number;
      detail?: string;
    };

export interface GuardedFetchOptions {
  signal: AbortSignal;
  maxBytes: number;
  /**
   * A tighter cap chosen from the response's content type (lower-cased media
   * type, no parameters; null when absent), never above `maxBytes` — so one GET
   * can allow 10 MB of PDF and 5 MB of HTML without knowing which it will get.
   */
  maxBytesFor?: (contentType: string | null) => number;
  /** Hosts every hop must be on: the host itself or a subdomain of it. */
  allowedHosts?: readonly string[];
  accept?: string;
  userAgent?: string;
  /** Redirects followed before giving up. Default 3. */
  maxRedirects?: number;
  /**
   * Media types (lower-cased, no parameters) refused on the final response's
   * headers, before any of its body is read: `unsupported`, with the type as
   * `detail`. For a caller that wants a PDF and has no use for a product page.
   */
  refuseTypes?: readonly string[];
}

export const RESOLVE_HOST_HOOK = Symbol.for("makerlab.web.resolveHost");
export const TEST_ORIGIN_ENV = "READ_PAGE_TEST_ORIGIN";

const DEFAULT_USER_AGENT = "MakerLabTools/5 (+research; server-side page reader)";

type Failure = Extract<GuardedFetchResult, { ok: false }>;

export async function guardedFetch(url: string, opts: GuardedFetchOptions): Promise<GuardedFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const allowed = normaliseHosts(opts.allowedHosts);
  let current = url;

  try {
    for (let hop = 0; ; hop += 1) {
      const refusal = await checkTarget(current, allowed);
      if (refusal) return refusal;

      let response: Response;
      try {
        response = await fetch(current, {
          method: "GET",
          redirect: "manual",
          signal: opts.signal,
          headers: {
            accept: opts.accept ?? "*/*",
            "user-agent": opts.userAgent ?? DEFAULT_USER_AGENT,
          },
        });
      } catch (error) {
        return networkFailure(current, error, opts.signal);
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        await discard(response);
        if (!location) {
          return { ok: false, url: current, reason: "http_error", status: response.status, detail: "redirect_without_location" };
        }
        if (hop >= maxRedirects) {
          return { ok: false, url: current, reason: "failed", status: response.status, detail: "too_many_redirects" };
        }
        try {
          current = new URL(location, current).href;
        } catch {
          return { ok: false, url: current, reason: "failed", detail: "invalid_redirect" };
        }
        continue;
      }

      if (!response.ok) {
        await discard(response);
        return { ok: false, url: current, reason: "http_error", status: response.status };
      }

      const contentType = mediaType(response.headers.get("content-type"));
      if (contentType && opts.refuseTypes?.includes(contentType)) {
        await discard(response);
        return { ok: false, url: current, reason: "unsupported", status: response.status, detail: contentType };
      }
      const cap = Math.min(opts.maxBytes, opts.maxBytesFor?.(contentType) ?? opts.maxBytes);
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > cap) {
        await discard(response);
        return { ok: false, url: current, reason: "too_large", status: response.status };
      }

      const body = await readCapped(response, cap, opts.signal);
      if (body === "too_large") {
        return { ok: false, url: current, reason: "too_large", status: response.status };
      }
      if (!(body instanceof Uint8Array)) return networkFailure(current, body.error, opts.signal);

      return {
        ok: true,
        url: current,
        status: response.status,
        contentType: response.headers.get("content-type"),
        bytes: body,
        headers: response.headers,
      };
    }
  } catch (error) {
    // Nothing above should throw; this is the "never throws" guarantee.
    return networkFailure(current, error, opts.signal);
  }
}

/** Why `url` may not be requested, or null when it may. */
async function checkTarget(url: string, allowed: string[] | null): Promise<Failure | null> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, url, reason: "blocked", detail: "invalid_url" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, url, reason: "blocked", detail: "scheme" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, url, reason: "blocked", detail: "credentials_in_url" };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (allowed && !allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))) {
    return { ok: false, url, reason: "blocked", detail: "host_not_allowed" };
  }

  if (isTestOrigin(parsed)) return null;

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolveHost(host);
    } catch {
      return { ok: false, url, reason: "failed", detail: "dns" };
    }
    if (addresses.length === 0) return { ok: false, url, reason: "failed", detail: "dns" };
  }
  if (addresses.some(isForbiddenAddress)) {
    return { ok: false, url, reason: "blocked", detail: "forbidden_address" };
  }
  return null;
}

async function resolveHost(host: string): Promise<string[]> {
  const hook = (globalThis as Record<symbol, unknown>)[RESOLVE_HOST_HOOK];
  if (typeof hook === "function") {
    return (await (hook as (hostname: string) => Promise<string[]>)(host)).map(String);
  }
  const found = await lookup(host, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
}

function isTestOrigin(url: URL): boolean {
  const configured = process.env[TEST_ORIGIN_ENV]?.trim();
  if (!configured || process.env.VERCEL) return false;
  try {
    return new URL(configured).origin === url.origin;
  } catch {
    return false;
  }
}

function normaliseHosts(hosts: readonly string[] | undefined): string[] | null {
  if (hosts === undefined) return null;
  return hosts
    .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, ""))
    .filter((h) => h.length > 0);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function mediaType(header: string | null): string | null {
  const type = header?.split(";")[0].trim().toLowerCase();
  return type ? type : null;
}

/**
 * Let go of a body nobody will read. Not awaited: a cancel can wait on the
 * server (MSW's interceptor never settles it), and nothing here needs it done.
 */
async function discard(response: Response): Promise<void> {
  try {
    response.body?.cancel().catch(() => {});
  } catch {
    // A locked or already-consumed body: nothing to release.
  }
}

async function readCapped(
  response: Response,
  cap: number,
  signal: AbortSignal
): Promise<Uint8Array | "too_large" | { error: unknown }> {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (signal.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        reader.cancel().catch(() => {});
        return "too_large";
      }
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    return { error };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function networkFailure(url: string, error: unknown, signal: AbortSignal): Failure {
  const name = (error as { name?: unknown } | null)?.name;
  if (signal.aborted || name === "AbortError" || name === "TimeoutError") {
    return { ok: false, url, reason: "timeout" };
  }
  return { ok: false, url, reason: "failed", detail: "network" };
}
