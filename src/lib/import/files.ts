/**
 * Copying files out of Notion (spec §5.7 step 4).
 *
 * Notion-hosted file URLs are signed and expire about an hour after they are
 * read, so the import downloads each file's bytes during the run and uploads
 * them to Vercel Blob. A URL is never stored. The uploader is an interface so
 * the run can be tested against an in-memory store with no network.
 */

export interface BlobUploader {
  put(
    pathname: string,
    body: Uint8Array,
    options: { access: "public" | "private"; contentType?: string }
  ): Promise<{ pathname: string; url: string }>;
}

export interface CopiedFile {
  blobPathname: string;
  /** Set for public blobs only; private ones are read back through the SDK. */
  publicUrl: string | null;
  contentType: string | null;
  sizeBytes: number;
}

// Fields are declared and assigned explicitly rather than as constructor
// parameter properties: the import script loads this module under Node's
// type stripping, which erases types but cannot rewrite that TypeScript-only syntax.
export class FileCopyError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(url: string, message: string, status?: number) {
    super(`${message} (${url})`);
    this.name = "FileCopyError";
    this.url = url;
    this.status = status;
  }
}

/** Hosts whose URLs are known to be dead; skipped without a request. */
export const STALE_FILE_HOSTS = ["airtableusercontent.com"];

export function isStaleFileUrl(url: string): boolean {
  return STALE_FILE_HOSTS.some((host) => url.includes(host));
}

/** Larger than anything the catalogue holds; a guard against a stray video. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export interface FileCopier {
  copy(sourceUrl: string, destination: { pathname: string; access: "public" | "private" }): Promise<CopiedFile>;
}

export function createFileCopier(uploader: BlobUploader, fetchImpl: typeof fetch = fetch): FileCopier {
  return {
    async copy(sourceUrl, destination) {
      let response: Response;
      try {
        response = await fetchImpl(sourceUrl);
      } catch (error) {
        throw new FileCopyError(sourceUrl, `download failed: ${(error as Error).message}`);
      }
      if (!response.ok) {
        throw new FileCopyError(sourceUrl, `download returned ${response.status}`, response.status);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0) throw new FileCopyError(sourceUrl, "download was empty");
      if (bytes.byteLength > MAX_FILE_BYTES) {
        throw new FileCopyError(sourceUrl, `file is ${bytes.byteLength} bytes, over the ${MAX_FILE_BYTES} limit`);
      }

      const contentType = response.headers.get("content-type")?.split(";")[0].trim() || null;
      const stored = await uploader.put(destination.pathname, bytes, {
        access: destination.access,
        contentType: contentType ?? undefined,
      });

      return {
        blobPathname: stored.pathname,
        publicUrl: destination.access === "public" ? stored.url : null,
        contentType,
        sizeBytes: bytes.byteLength,
      };
    },
  };
}

/** A filename safe to use as the last segment of a blob pathname. */
export function safeFilename(name: string, fallback = "file"): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}
