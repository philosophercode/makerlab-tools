import type { TablePlan } from "./tables.ts";

/**
 * What happens to one row between the local database and the hosted one:
 * secrets blanked, generated columns dropped, local-file URLs swapped for the
 * Vercel Blob copies, deferred foreign keys held back for the second pass.
 *
 * Rows travel as `to_jsonb(row)` objects keyed by SQL column name, so a value
 * is whatever Postgres prints for it (timestamps with their microseconds,
 * vectors as `[…]`, bytea as `\x…`) and goes back in through
 * `jsonb_populate_recordset` unchanged.
 */

export type Row = Record<string, unknown>;

/** The path the dev server serves the local store under (`src/app/api/dev-blob`). */
export const DEV_BLOB_PATH = "/api/dev-blob/";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/**
 * True for a URL the local store wrote (`localBlobUrl` in `blob-local.ts`):
 * `/api/dev-blob/…` on this laptop — any loopback host and port (the dev
 * server may have run on :3000 or :3001), or the configured `origin`.
 */
export function isLocalBlobUrl(value: string, origin?: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (!url.pathname.startsWith(DEV_BLOB_PATH)) return false;
  if (LOOPBACK_HOSTS.has(url.hostname)) return true;
  if (!origin) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

/** `http://localhost:3001/api/dev-blob/tools/a%20b.jpg` → `tools/a b.jpg`. */
export function localPathnameFromUrl(value: string): string {
  const path = new URL(value).pathname.slice(DEV_BLOB_PATH.length);
  return path.split("/").map(decodeURIComponent).join("/");
}

/** Where one local file went. */
export interface UploadedFile {
  pathname: string;
  url: string;
  access: "public" | "private";
}

/** The rewrite table built from the uploads: local pathname → uploaded copy, and old URL → new URL. */
export interface Rewrites {
  byPathname: Map<string, UploadedFile>;
  byUrl: Map<string, string>;
}

export function emptyRewrites(): Rewrites {
  return { byPathname: new Map(), byUrl: new Map() };
}

/**
 * Replace every occurrence of an old URL, anywhere in a value: a text column,
 * a string inside jsonb (research results, audit details), an array element.
 * Longest URLs first, so one URL that prefixes another is not half-replaced.
 */
export function rewriteUrls(value: unknown, byUrl: Map<string, string>): unknown {
  if (byUrl.size === 0) return value;
  const pairs = [...byUrl.entries()].sort((a, b) => b[0].length - a[0].length);
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (!v.includes(DEV_BLOB_PATH)) return v;
      let out = v;
      for (const [from, to] of pairs) if (out.includes(from)) out = out.split(from).join(to);
      return out;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v as Row).map(([k, x]) => [k, visit(x)]));
    }
    return v;
  };
  return visit(value);
}

/**
 * One row, ready for the target: redacted, generated columns dropped, local
 * files pointed at their uploaded copies, deferred columns nulled.
 *
 * Returns the row and, when a deferred column held a value, what the second
 * pass must restore.
 */
export function transformRow(
  plan: TablePlan,
  source: Row,
  rewrites: Rewrites
): { row: Row; deferred: Row | null } {
  let row: Row = { ...source };
  for (const column of plan.generated) delete row[column];
  for (const column of plan.redacted) if (column in row) row[column] = null;

  if (plan.name === "attachments") {
    const pathname = row.blob_pathname;
    const uploaded = typeof pathname === "string" ? rewrites.byPathname.get(pathname) : undefined;
    if (uploaded) {
      row.blob_pathname = uploaded.pathname;
      row.public_url = uploaded.access === "public" ? uploaded.url : null;
    }
  }

  row = rewriteUrls(row, rewrites.byUrl) as Row;

  let deferred: Row | null = null;
  for (const column of plan.deferred) {
    if (row[column] === null || row[column] === undefined) continue;
    deferred ??= Object.fromEntries(plan.primaryKey.map((k) => [k, row[k]]));
    deferred[column] = row[column];
    row[column] = null;
  }
  return { row, deferred };
}

/** True when a row still mentions the local store after rewriting (reported, not fatal). */
export function mentionsLocalStore(row: Row): boolean {
  return JSON.stringify(row).includes(DEV_BLOB_PATH);
}
