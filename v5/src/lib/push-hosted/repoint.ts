import { getTableConfig, type PgColumn } from "drizzle-orm/pg-core";
import { blobStoreHost, rewriteUrls, VERCEL_BLOB_HOST_SUFFIX, type Row } from "./rows.ts";
import { ident, type SqlClient } from "./sql.ts";
import { planTables, schemaTables } from "./tables.ts";

/**
 * `npm run blob:repoint` without the command line (manual text spec amendment
 * 2026-09-28): repair a hosted database that holds URLs on a Blob store that
 * is **not** the deployment's own — the store deleted and recreated on
 * 2026-09-27 — by pointing each one at the file the deployment's store now
 * holds for it.
 *
 * - **Where the right URL comes from:** the `attachments` rows on the
 *   target's store. A file keeps its pathname across uploads, each upload
 *   only adding a random suffix (`manuals/<tool>/<resource>-<suffix>.pdf`), so
 *   an old URL and the current copy share a **stem** — the pathname with its
 *   random suffixes removed ({@link pathnameStem}). One current attachment per
 *   stem is a match; none, or several, is reported and left alone.
 * - **What is rewritten:** every column of every copied table that can hold a
 *   string (text, varchar, text[], jsonb) — the same scan `url-columns.test.ts`
 *   pins for `data:push` — so a manual's URL copied into a resource, a research
 *   result or an audit detail is repaired wherever it sits.
 * - **What is not:** an `attachments` row whose own `public_url` is on the old
 *   store has no copy on the new one; it is listed, and `data:push` (which now
 *   carries such files) is the fix.
 *
 * **Dry run by default.** `apply` updates the rows in one transaction.
 */

export interface RepointOptions {
  target: SqlClient;
  /** The deployment's store hosts (`storeHosts` in `target-env.ts`). Required: without them nothing is foreign. */
  targetHosts: readonly string[];
  apply: boolean;
  log?: (line: string) => void;
}

export interface RepointChange {
  table: string;
  column: string;
  /** Primary key values of the row. */
  key: Row;
  /** Old URL → new URL, for each URL the value held. */
  urls: [string, string][];
}

export interface RepointReport {
  changes: RepointChange[];
  /** Old-store URLs with no single current copy: `none` or `ambiguous`. */
  unmatched: { url: string; reason: "none" | "ambiguous"; where: string }[];
  /** Attachment rows whose own file is on the old store (fix: `data:push`). */
  brokenAttachments: { id: string; url: string }[];
  applied: boolean;
}

/** Random suffixes the uploaders add (Vercel ~30 characters, the local store 20). */
const SUFFIX = /-[A-Za-z0-9]{16,}$/;

/** `manuals/t/r-BoVu…Dg-1X1v…Ca.pdf` → `manuals/t/r.pdf`: the pathname without its random suffixes. */
export function pathnameStem(pathname: string): string {
  const slash = pathname.lastIndexOf("/");
  const dir = pathname.slice(0, slash + 1);
  const name = pathname.slice(slash + 1);
  const dot = name.lastIndexOf(".");
  let base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  while (SUFFIX.test(base)) base = base.replace(SUFFIX, "");
  return `${dir}${base}${ext}`;
}

/** Every Vercel Blob URL in a string, without trailing punctuation; the fragment is not part of it. */
export function blobUrlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\/[^\s"'<>)\]#?]+/gi)].map((m) => m[0]);
}

type Kind = "text" | "array" | "json";

function stringKind(column: PgColumn): Kind | null {
  const type = column.columnType;
  if (type === "PgText" || type === "PgVarchar" || type === "PgChar") return "text";
  if (type === "PgJsonb" || type === "PgJson") return "json";
  if (type === "PgArray") {
    const base = (column as unknown as { baseColumn?: PgColumn }).baseColumn;
    return base && stringKind(base) === "text" ? "array" : null;
  }
  return null;
}

/** Every copied table's string-capable columns, with its primary key. */
export function repointColumns(): { table: string; primaryKey: string[]; columns: { name: string; kind: Kind }[] }[] {
  const plans = new Map(planTables().tables.map((t) => [t.name, t]));
  const out = [];
  for (const table of schemaTables()) {
    const config = getTableConfig(table);
    const plan = plans.get(config.name);
    if (!plan || plan.primaryKey.length === 0) continue;
    const columns = config.columns
      .filter((c) => !c.generated)
      .map((c) => ({ name: c.name, kind: stringKind(c) }))
      .filter((c): c is { name: string; kind: Kind } => c.kind !== null);
    if (columns.length > 0) out.push({ table: config.name, primaryKey: plan.primaryKey, columns });
  }
  return out;
}

export async function runRepoint(options: RepointOptions): Promise<RepointReport> {
  const log = options.log ?? (() => {});
  const hosts = options.targetHosts.map((h) => h.toLowerCase());
  if (hosts.length === 0) throw new Error("No target Blob store: nothing can be told apart from it.");
  const isForeign = (url: string) => {
    const host = blobStoreHost(url);
    return host !== null && !hosts.includes(host);
  };

  // The current copies, by stem.
  const attachments = await options.target.query<{ id: string; blob_pathname: string; public_url: string | null }>(
    "select id::text as id, blob_pathname, public_url from attachments"
  );
  const byStem = new Map<string, Set<string>>();
  const brokenAttachments: RepointReport["brokenAttachments"] = [];
  for (const row of attachments) {
    if (!row.public_url) continue;
    if (isForeign(row.public_url)) {
      brokenAttachments.push({ id: row.id, url: row.public_url });
      continue;
    }
    if (!blobStoreHost(row.public_url)) continue;
    const stem = pathnameStem(urlPathname(row.public_url));
    const set = byStem.get(stem) ?? new Set<string>();
    set.add(row.public_url);
    byStem.set(stem, set);
  }

  const changes: RepointChange[] = [];
  const unmatched: RepointReport["unmatched"] = [];
  const seenUnmatched = new Set<string>();
  for (const { table, primaryKey, columns } of repointColumns()) {
    for (const column of columns) {
      // Rows whose value mentions any Blob store at all; the foreign test is ours.
      const rows = await options.target.query<Row>(
        `select ${primaryKey.map((k) => `${ident(k)}::text as ${ident(k)}`).join(", ")}, ${ident(column.name)} as v ` +
          `from ${ident(table)} where ${ident(column.name)}::text like $1`,
        [`%${VERCEL_BLOB_HOST_SUFFIX}%`]
      );
      for (const row of rows) {
        // Attachments' own URL is not re-pointed: its file is the one missing.
        if (table === "attachments" && column.name === "public_url") continue;
        const text = typeof row.v === "string" ? row.v : JSON.stringify(row.v);
        const map = new Map<string, string>();
        for (const url of blobUrlsIn(text)) {
          if (!isForeign(url) || map.has(url)) continue;
          const stem = pathnameStem(urlPathname(url));
          const found = byStem.get(stem);
          if (found?.size === 1) {
            map.set(url, [...found][0]);
          } else if (!seenUnmatched.has(url)) {
            seenUnmatched.add(url);
            unmatched.push({ url, reason: found ? "ambiguous" : "none", where: `${table}.${column.name}` });
          }
        }
        if (map.size === 0) continue;
        const key = Object.fromEntries(primaryKey.map((k) => [k, row[k]]));
        changes.push({ table, column: column.name, key, urls: [...map] });
      }
    }
  }

  const byColumn = new Map<string, number>();
  for (const change of changes) byColumn.set(`${change.table}.${change.column}`, (byColumn.get(`${change.table}.${change.column}`) ?? 0) + 1);
  log(`Rows naming another Blob store that can be re-pointed: ${changes.length}`);
  for (const [where, n] of [...byColumn].sort()) log(`  ${where.padEnd(34)} ${n}`);
  for (const change of changes.slice(0, 10)) {
    log(`  e.g. ${change.table}.${change.column} ${JSON.stringify(change.key)}: ${change.urls[0][0]} → ${change.urls[0][1]}`);
  }
  if (unmatched.length > 0) {
    log(`Old-store URLs with no single current copy (left alone): ${unmatched.length}`);
    for (const u of unmatched.slice(0, 20)) log(`  ${u.reason.padEnd(9)} ${u.where}  ${u.url}`);
  }
  if (brokenAttachments.length > 0) {
    log(`Attachment rows whose own file is on another store (fix: npm run data:push): ${brokenAttachments.length}`);
    for (const b of brokenAttachments.slice(0, 20)) log(`  attachment ${b.id}  ${b.url}`);
  }

  if (!options.apply || changes.length === 0) return { changes, unmatched, brokenAttachments, applied: false };

  await options.target.query("begin");
  try {
    for (const change of changes) {
      const kind = repointColumns()
        .find((t) => t.table === change.table)!
        .columns.find((c) => c.name === change.column)!.kind;
      const [current] = await options.target.query<{ v: unknown }>(
        `select ${ident(change.column)} as v from ${ident(change.table)} where ${whereKey(change.key, 1)}`,
        Object.values(change.key)
      );
      const next = rewriteUrls(current?.v, new Map(change.urls));
      const cast = kind === "json" ? "::jsonb" : kind === "array" ? "::text[]" : "";
      await options.target.query(
        `update ${ident(change.table)} set ${ident(change.column)} = $1${cast} where ${whereKey(change.key, 2)}`,
        [kind === "json" ? JSON.stringify(next) : next, ...Object.values(change.key)]
      );
    }
    await options.target.query("commit");
  } catch (error) {
    await options.target.query("rollback").catch(() => {});
    throw error;
  }
  log(`Re-pointed ${changes.length} row value(s).`);
  return { changes, unmatched, brokenAttachments, applied: true };
}

/** A Blob URL's pathname, decoded, without the leading slash. */
function urlPathname(url: string): string {
  const path = new URL(url).pathname.slice(1);
  try {
    return path.split("/").map(decodeURIComponent).join("/");
  } catch {
    return path;
  }
}

function whereKey(key: Row, firstParam: number): string {
  return Object.keys(key)
    .map((k, i) => `${ident(k)}::text = $${firstParam + i}`)
    .join(" and ");
}
