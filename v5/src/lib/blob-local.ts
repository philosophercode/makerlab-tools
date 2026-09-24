import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * A folder that behaves like Vercel Blob, for a laptop with no
 * `BLOB_READ_WRITE_TOKEN` (`blobMode() === "local"`, see `blob-mode.ts`).
 *
 * Bytes live at `.blob-data/<pathname>`; what the real store would remember
 * about each one — access, content type, size, upload time — lives beside them
 * in `.blob-data/.meta/<pathname>.json`. The folder is git-ignored.
 *
 * It keeps the store's semantics that callers rely on: a random suffix when
 * asked for one (so `putUpload` and `copyToPublic` return a pathname the caller
 * did not choose), a refusal to overwrite unless allowed, and public vs private
 * access — a public file is served by `GET /api/dev-blob/<pathname>`, a private
 * one never is.
 *
 * Not `server-only` (the manual archiver runs under plain Node), and never used
 * unless `blobMode()` says "local", which it cannot on Vercel or in a
 * production build.
 */

export type LocalBlobAccess = "public" | "private";

export interface LocalBlobMeta {
  access: LocalBlobAccess;
  contentType: string;
  size: number;
  uploadedAt: string;
}

export interface LocalPutOptions {
  access: LocalBlobAccess;
  contentType?: string;
  addRandomSuffix?: boolean;
  allowOverwrite?: boolean;
}

export interface LocalBlobBackend {
  put(
    pathname: string,
    body: string | Uint8Array | Blob,
    options: LocalPutOptions
  ): Promise<{ pathname: string; url: string }>;
  copy(
    from: string,
    to: string,
    options: { access: LocalBlobAccess; addRandomSuffix?: boolean }
  ): Promise<{ pathname: string; url: string }>;
  list(prefix: string): Promise<{ pathname: string; uploadedAt: string }[]>;
  del(pathnames: string[]): Promise<void>;
  /** The bytes and metadata, or null when there is no such blob. */
  read(pathname: string): Promise<{ body: Uint8Array; meta: LocalBlobMeta } | null>;
}

/** Where the folder is: `.blob-data/` in the working directory (v5/ under `next dev`). */
export function localBlobRoot(): string {
  return join(process.cwd(), ".blob-data");
}

const META_DIR = ".meta";

/**
 * The origin written into a public file's URL. `AUTH_BASE_URL` is what local
 * development already sets to the dev server's own address (it is the OAuth
 * return origin); without it, Next's default port.
 */
export function localBlobOrigin(): string {
  const explicit = (process.env.AUTH_BASE_URL || "").trim();
  return (explicit || "http://localhost:3000").replace(/\/$/, "");
}

export function localBlobUrl(pathname: string): string {
  const encoded = pathname.split("/").map(encodeURIComponent).join("/");
  return `${localBlobOrigin()}/api/dev-blob/${encoded}`;
}

/**
 * Validate a pathname and map it into the folder. Refuses anything that could
 * leave the folder or reach the metadata: empty, `.` / `..` or dot-leading
 * segments, backslashes, NUL, absolute paths. Throws on refusal.
 */
export function resolveLocalPath(root: string, pathname: string): string {
  if (typeof pathname !== "string" || pathname.length === 0 || pathname.length > 1024) {
    throw new Error("Invalid blob pathname");
  }
  if (pathname.includes("\\") || pathname.includes("\0") || pathname.startsWith("/")) {
    throw new Error("Invalid blob pathname");
  }
  const segments = pathname.split("/");
  if (segments.some((s) => s.length === 0 || s.startsWith("."))) {
    throw new Error("Invalid blob pathname");
  }
  const base = resolve(root);
  const full = resolve(base, ...segments);
  if (!full.startsWith(base + sep)) throw new Error("Invalid blob pathname");
  return full;
}

function metaPath(root: string, pathname: string): string {
  // `pathname` has already been through resolveLocalPath.
  return join(resolve(root), META_DIR, `${pathname}.json`);
}

/** `photo.jpg` → `photo-<entropy>.jpg`, as Vercel Blob's `addRandomSuffix` does. */
function withRandomSuffix(pathname: string): string {
  const slash = pathname.lastIndexOf("/");
  const dir = pathname.slice(0, slash + 1);
  const name = pathname.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  const suffix = randomBytes(16).toString("base64url").replace(/[-_]/g, "").slice(0, 20);
  if (dot <= 0) return `${dir}${name}-${suffix}`;
  return `${dir}${name.slice(0, dot)}-${suffix}${name.slice(dot)}`;
}

async function toBytes(body: string | Uint8Array | Blob): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  return new Uint8Array(await body.arrayBuffer());
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(root: string, pathname: string): Promise<LocalBlobMeta | null> {
  try {
    return JSON.parse(await readFile(metaPath(root, pathname), "utf8")) as LocalBlobMeta;
  } catch {
    return null;
  }
}

export function createLocalBlobBackend(root: string = localBlobRoot()): LocalBlobBackend {
  async function write(
    requested: string,
    bytes: Uint8Array,
    options: LocalPutOptions
  ): Promise<{ pathname: string; url: string }> {
    const pathname = options.addRandomSuffix ? withRandomSuffix(requested) : requested;
    const file = resolveLocalPath(root, pathname);
    if (!options.allowOverwrite && (await exists(file))) {
      throw new Error(`This blob already exists: ${pathname}`);
    }
    const meta: LocalBlobMeta = {
      access: options.access,
      contentType: options.contentType || "application/octet-stream",
      size: bytes.byteLength,
      uploadedAt: new Date().toISOString(),
    };
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
    const metaFile = metaPath(root, pathname);
    await mkdir(dirname(metaFile), { recursive: true });
    await writeFile(metaFile, JSON.stringify(meta));
    return { pathname, url: localBlobUrl(pathname) };
  }

  async function read(pathname: string) {
    const file = resolveLocalPath(root, pathname);
    const meta = await readMeta(root, pathname);
    if (!meta) return null;
    try {
      return { body: new Uint8Array(await readFile(file)), meta };
    } catch {
      return null;
    }
  }

  return {
    async put(pathname, body, options) {
      return write(pathname, await toBytes(body), options);
    },

    async copy(from, to, options) {
      const source = await read(from);
      if (!source) throw new Error(`The requested blob does not exist: ${from}`);
      return write(to, source.body, {
        access: options.access,
        contentType: source.meta.contentType,
        addRandomSuffix: options.addRandomSuffix,
      });
    },

    async list(prefix) {
      const base = resolve(root);
      let entries: string[];
      try {
        entries = (await readdir(base, { recursive: true, withFileTypes: true }))
          .filter((e) => e.isFile())
          .map((e) => relative(base, join(e.parentPath, e.name)).split(sep).join("/"));
      } catch {
        return [];
      }
      const blobs: { pathname: string; uploadedAt: string }[] = [];
      for (const pathname of entries.sort()) {
        if (pathname.startsWith(`${META_DIR}/`) || !pathname.startsWith(prefix)) continue;
        const meta = await readMeta(root, pathname);
        if (!meta) continue;
        blobs.push({ pathname, uploadedAt: meta.uploadedAt });
      }
      return blobs;
    },

    async del(pathnames) {
      for (const pathname of pathnames) {
        const file = resolveLocalPath(root, pathname);
        await rm(file, { force: true });
        await rm(metaPath(root, pathname), { force: true });
      }
    },

    read,
  };
}
