import { eq } from "drizzle-orm";
import { claimAttachments, createAttachment } from "../data/attachments.ts";
import {
  listResourcePdfs,
  manualSourceKey,
  MAX_ARCHIVABLE_URL_LENGTH,
  isManualArchiveKey,
  releaseStaleManualArchives,
} from "../data/manual-archives.ts";
import { isUuid } from "../data/uuid.ts";
import { getDb } from "../db/client.ts";
import { resources } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { createBlobUploader } from "../import/blob-uploader.ts";
import { safeFilename, type BlobUploader } from "../import/files.ts";
import { guardedFetch, type GuardedFetchResult } from "../web/guarded-fetch.ts";
import { hasPdfMagic } from "../web/pdf-magic.ts";

/**
 * `archiveManual(resourceId)` — copy a resource's manual PDF into Blob, so the
 * tool keeps its manual after the manufacturer moves or deletes it (link rot).
 *
 * The copy is an `attachments` row owned by the resource — public,
 * `application/pdf`, keyed `manual:<resource id>:<source url>` (see
 * `data/manual-archives.ts`). The resource keeps its own `url`, the
 * manufacturer's link; the catalogue and the chat prefer the copy.
 *
 * **What is archived.** A resource with an http(s) link that is a Manual, or
 * whose link turns out to be a PDF. The response must *be* a PDF — `%PDF-` in
 * its first kilobyte, or `application/pdf` on a body that is not markup — so a
 * manual link that points at an HTML product page is refused, not stored as a
 * "manual". 30 seconds, 25 MB, and nothing larger is read.
 *
 * **The download goes through the SSRF guard** (`web/guarded-fetch.ts`). The
 * link was proposed by research from a page on the web, and only checked once,
 * when research verified it; by the time it is archived its host may answer
 * with a redirect inward. So every hop is re-checked, at most
 * {@link MANUAL_MAX_REDIRECTS} are followed, and a private, loopback,
 * link-local or metadata address is `blocked` without a request.
 *
 * **It never throws for an expected failure.** Every outcome is a value:
 * `archived`, `skipped` (nothing to do, or nothing it may do) or `failed`
 * (tried and could not), with `transient` on a failure a retry could fix — a
 * dropped connection, a timeout, a 5xx or a 429. The workflow step retries
 * only those. What does throw is the database, which the step classifies.
 *
 * **Nothing secret is logged.** The one log line carries the resource id, the
 * outcome and the link's host — never its path or query, which for a signed
 * URL is the credential.
 *
 * Runs as a workflow step under plain Node: relative imports, and no
 * `"server-only"` anywhere below it — which is why the Blob write goes through
 * the import's uploader (`import/blob-uploader.ts`) rather than `lib/blob.ts`.
 */

/** Longest a download may take, headers and body together. */
export const MANUAL_FETCH_TIMEOUT_MS = 30_000;

/** Largest manual archived. Bigger ones are refused, not truncated. */
export const MAX_MANUAL_BYTES = 25 * 1024 * 1024;

/** Redirects followed. More than the guard's default 3: download links bounce through CDNs. */
export const MANUAL_MAX_REDIRECTS = 5;

const FETCH_USER_AGENT = "Mozilla/5.0 (compatible; MakerLabBot/1.0; manual archive)";

export type ArchiveSkipReason =
  /** No such resource, or not a uuid. */
  | "not_found"
  /** No http(s) link to copy from. */
  | "no_url"
  /** A link too long to key (see `MAX_ARCHIVABLE_URL_LENGTH`). */
  | "url_too_long"
  /** Already archived from this link. */
  | "already_archived"
  /** The resource already holds a PDF somebody uploaded or the import copied. */
  | "has_file"
  /** Not a Manual, and the link did not answer a PDF. */
  | "not_pdf"
  /** No Blob store: no `BLOB_READ_WRITE_TOKEN`, and not local development (`blob-mode.ts`). */
  | "blob_not_configured";

export type ArchiveFailReason =
  /** The request never got an answer: DNS, connection, timeout. */
  | "download_failed"
  /** The link, or a redirect from it, leads to a private, loopback or metadata address. */
  | "blocked"
  /** The host answered with an error status. */
  | "http_error"
  /** A Manual whose link answered something other than a PDF — a product page, usually. */
  | "not_pdf"
  /** Over {@link MAX_MANUAL_BYTES}. */
  | "too_large"
  /** An empty body. */
  | "empty"
  /** The Blob write failed. */
  | "upload_failed";

export type ArchiveManualResult =
  | { status: "archived"; reason: "archived"; attachmentId: string; publicUrl: string; sizeBytes: number }
  | { status: "skipped"; reason: ArchiveSkipReason }
  | { status: "failed"; reason: ArchiveFailReason; transient: boolean; httpStatus?: number };

export interface ArchiveManualOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
  /** Cancels the download along with the 30-second timeout. */
  signal?: AbortSignal;
  /**
   * The Blob write. Defaults to whatever `blobMode()` allows — Vercel Blob
   * with a token, `.blob-data/` in local development; with no store and no
   * uploader, the archive is skipped as `blob_not_configured`.
   */
  uploader?: BlobUploader;
}

export async function archiveManual(
  resourceId: string,
  options: ArchiveManualOptions = {}
): Promise<ArchiveManualResult> {
  const result = await archive(resourceId, options);
  logOutcome(resourceId, result.outcome, result.host);
  return result.outcome;
}

interface Attempt {
  outcome: ArchiveManualResult;
  host?: string;
}

async function archive(resourceId: string, options: ArchiveManualOptions): Promise<Attempt> {
  if (!isUuid(resourceId)) return skip("not_found");
  const db = options.db ?? (await getDb());

  const [resource] = await db
    .select({ id: resources.id, toolId: resources.toolId, title: resources.title, type: resources.type, url: resources.url })
    .from(resources)
    .where(eq(resources.id, resourceId));
  if (!resource) return skip("not_found");

  const url = resource.url?.trim() ?? "";
  if (!/^https?:\/\//i.test(url)) return skip("no_url");
  const host = hostOf(url);
  if (url.length > MAX_ARCHIVABLE_URL_LENGTH) return skip("url_too_long", host);

  const key = manualSourceKey(resource.id, url);
  const held = await listResourcePdfs(db, resource.id);
  if (held.some((pdf) => pdf.sourceKey === key)) return skip("already_archived", host);
  if (held.some((pdf) => !isManualArchiveKey(pdf.sourceKey))) return skip("has_file", host);

  const uploader = options.uploader ?? createBlobUploader();
  if (!uploader) return skip("blob_not_configured", host);

  const isManual = (resource.type ?? "").trim().toLowerCase() === "manual";

  const downloaded = await download(url, options);
  if (!downloaded.ok) {
    // A link that is not a Manual and does not answer a PDF is simply a link.
    if (downloaded.reason === "not_pdf" && !isManual) return skip("not_pdf", host);
    return { outcome: { status: "failed", ...downloaded.failure }, host };
  }

  let stored: { pathname: string; url: string };
  try {
    stored = await uploader.put(`manuals/${resource.toolId ?? "unassigned"}/${resource.id}.pdf`, downloaded.bytes, {
      access: "public",
      contentType: "application/pdf",
    });
  } catch {
    return fail("upload_failed", true, host);
  }

  const filename = downloaded.filename ?? filenameFromUrl(url) ?? `${safeFilename(resource.title, "manual")}.pdf`;
  const file = {
    blobPathname: stored.pathname,
    access: "public" as const,
    publicUrl: stored.url,
    contentType: "application/pdf",
    sizeBytes: downloaded.bytes.byteLength,
    originalFilename: filename,
    uploadedBy: null,
    // `source_key` is the idempotency key; `source_url` is the attribution
    // every copy the app makes records (gateway spec §4.2).
    origin: "manual_archive" as const,
    sourceUrl: url,
  };

  let attachmentId: string | null;
  try {
    attachmentId = await db.transaction(async (tx) => {
      // Somebody else's run may have landed the same copy while this one
      // downloaded (approval and the nightly backfill can overlap). Its row
      // wins — never hold a transaction open across a 30-second download.
      const now = await listResourcePdfs(tx, resource.id);
      if (now.some((pdf) => pdf.sourceKey === key)) return null;

      await releaseStaleManualArchives(tx, resource.id, key);
      const created = await createAttachment({ ...file, sourceKey: key }, { db: tx });
      await claimAttachments(tx, [created.id], { ownerType: "resource", ownerId: resource.id });
      return created.id;
    });
  } catch (error) {
    // The same race, lost at the unique index instead of the read above.
    if (!isUniqueViolation(error)) throw error;
    attachmentId = null;
  }
  if (!attachmentId) {
    // The losing run's blob is recorded *unowned*, so the daily sweep deletes
    // it after 24 hours instead of it sitting in Blob with no row forever.
    await createAttachment(file, { db }).catch(() => {});
    return skip("already_archived", host);
  }

  return {
    outcome: {
      status: "archived",
      reason: "archived",
      attachmentId,
      publicUrl: stored.url,
      sizeBytes: downloaded.bytes.byteLength,
    },
    host,
  };
}

// ── The download ────────────────────────────────────────────────────

type Download =
  | { ok: true; bytes: Uint8Array; filename: string | null }
  | {
      ok: false;
      reason: ArchiveFailReason;
      failure: { reason: ArchiveFailReason; transient: boolean; httpStatus?: number };
    };

async function download(url: string, options: ArchiveManualOptions): Promise<Download> {
  const timeout = AbortSignal.timeout(MANUAL_FETCH_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const fetched = await guardedFetch(url, {
    signal,
    maxBytes: MAX_MANUAL_BYTES,
    maxRedirects: MANUAL_MAX_REDIRECTS,
    accept: "application/pdf,*/*;q=0.5",
    userAgent: FETCH_USER_AGENT,
    // Markup is refused on the header alone, before a product page's body is
    // read — unless it is lying, which the magic bytes would show, and a server
    // that labels a PDF `text/html` is not one worth downloading 25 MB to catch.
    refuseTypes: ["text/html", "application/xhtml+xml"],
  });
  if (!fetched.ok) return downloadFailure(fetched);

  const contentType = fetched.contentType?.split(";")[0].trim().toLowerCase() ?? "";
  const bytes = fetched.bytes;
  if (bytes.byteLength === 0) return refused("empty", false);
  if (!looksLikePdf(bytes, contentType)) return refused("not_pdf", false);

  return { ok: true, bytes, filename: filenameFromDisposition(fetched.headers.get("content-disposition")) };
}

/** The guard's failure in the archive's words, transient where a retry could help. */
function downloadFailure(failure: Extract<GuardedFetchResult, { ok: false }>): Download {
  switch (failure.reason) {
    case "blocked":
      return refused("blocked", false);
    case "unsupported":
      return refused("not_pdf", false);
    case "too_large":
      return refused("too_large", false);
    case "http_error": {
      const status = failure.status;
      if (status === undefined) return refused("http_error", false);
      return refused("http_error", status >= 500 || status === 429 || status === 408, status);
    }
    case "timeout":
    case "failed":
      return refused("download_failed", true);
  }
}

function refused(reason: ArchiveFailReason, transient: boolean, httpStatus?: number): Download {
  return {
    ok: false,
    reason,
    failure: httpStatus === undefined ? { reason, transient } : { reason, transient, httpStatus },
  };
}

/**
 * `%PDF-` near the start, or a body declared `application/pdf` that does not
 * open like markup (some servers gzip-wrap or prefix; an error page still
 * starts with `<`).
 */
export function looksLikePdf(bytes: Uint8Array, contentType: string): boolean {
  if (hasPdfMagic(bytes)) return true;
  if (contentType !== "application/pdf") return false;
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return !head.startsWith("<");
}

/** The name a `Content-Disposition` header gives, if any — display only. */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)?''([^;]+)/.exec(header);
  if (extended) {
    try {
      return cleanName(decodeURIComponent(extended[1].trim().replace(/^"|"$/g, "")));
    } catch {
      // Malformed percent-encoding: fall through to the plain parameter.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/.exec(header);
  if (!plain) return null;
  return cleanName((plain[2] ?? plain[1]).trim());
}

/** The URL path's last segment, when it names a file. */
export function filenameFromUrl(url: string): string | null {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop();
    return last ? cleanName(decodeURIComponent(last)) : null;
  } catch {
    return null;
  }
}

function cleanName(name: string): string | null {
  const base = name.split(/[\\/]/).pop()?.trim() ?? "";
  return base ? base.slice(0, 200) : null;
}

// ── Outcomes ────────────────────────────────────────────────────────

function skip(reason: ArchiveSkipReason, host?: string): Attempt {
  return { outcome: { status: "skipped", reason }, host };
}

function fail(reason: ArchiveFailReason, transient: boolean, host?: string): Attempt {
  return { outcome: { status: "failed", reason, transient }, host };
}

/** Postgres `23505`, read by shape through drizzle's wrapping. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

/** One line: the resource, the outcome, the host. Never the path, query or any credential. */
function logOutcome(resourceId: string, outcome: ArchiveManualResult, host: string | undefined): void {
  const where = host ? ` host=${host}` : "";
  if (outcome.status === "failed") {
    const status = outcome.httpStatus ? ` status=${outcome.httpStatus}` : "";
    console.warn(`[manuals] archive failed: resource=${resourceId} reason=${outcome.reason}${status}${where}`);
  } else if (outcome.status === "archived") {
    console.info(`[manuals] archived: resource=${resourceId} bytes=${outcome.sizeBytes}${where}`);
  }
}
