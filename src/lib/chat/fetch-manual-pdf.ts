import { guardedFetch } from "../web/guarded-fetch";
import { hasPdfMagic } from "../web/pdf-magic";

/**
 * One manual PDF for the chat to attach as a file part (gateway spec §3.4),
 * fetched server-side so the model gets bytes rather than a URL.
 *
 * **Where it comes from decides how it is fetched.**
 * - **Our own store** (`ownStore`: a resource's archived copy or uploaded file —
 *   an `attachments.public_url` one of our uploaders wrote) is fetched plainly.
 *   Nobody outside the app chose that URL, and in local development it is a
 *   `localhost` URL (`blob-local.ts`) that the SSRF guard would refuse.
 * - **Anything else** is the resource's own link: proposed by research from a
 *   page on the web and only checked once, when research verified it. That goes
 *   through the SSRF guard (`web/guarded-fetch.ts`) — every redirect re-checked,
 *   private, loopback, link-local and metadata addresses refused, the body cut
 *   off at `maxBytes` instead of buffered whole.
 *
 * **Either way the bytes must open like a PDF** (`%PDF-`): a declared content
 * type proves nothing, and what is returned goes to the model labelled
 * `application/pdf`.
 *
 * Never throws; a failure is a short reason for the caller's log line.
 */

export interface ManualPdfSource {
  url: string;
  ownStore: boolean;
}

export interface FetchManualPdfOptions {
  maxBytes: number;
  timeoutMs: number;
  userAgent: string;
}

export type ManualPdfResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

export async function fetchManualPdf(source: ManualPdfSource, opts: FetchManualPdfOptions): Promise<ManualPdfResult> {
  const fetched = source.ownStore ? await fetchOwn(source.url, opts) : await fetchExternal(source.url, opts);
  if (!fetched.ok) return fetched;
  if (!hasPdfMagic(fetched.bytes)) return { ok: false, reason: "not a PDF" };
  return fetched;
}

async function fetchExternal(url: string, opts: FetchManualPdfOptions): Promise<ManualPdfResult> {
  const result = await guardedFetch(url, {
    signal: AbortSignal.timeout(opts.timeoutMs),
    maxBytes: opts.maxBytes,
    accept: "application/pdf,*/*;q=0.5",
    userAgent: opts.userAgent,
  });
  if (result.ok) return { ok: true, bytes: result.bytes };
  const status = result.status ? ` status ${result.status}` : "";
  return { ok: false, reason: `${result.reason}${status}` };
}

async function fetchOwn(url: string, opts: FetchManualPdfOptions): Promise<ManualPdfResult> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": opts.userAgent },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `status ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > opts.maxBytes) return { ok: false, reason: `too large (${bytes.byteLength} bytes)` };
    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: "failed" };
  }
}
