import { getBlobStore, isBlobConfigured } from "../../../../lib/blob";
import { getNotionEnvContract } from "../../../../lib/notion";
import { rateLimitAsync } from "../../../../lib/rate-limit";
import { resolveIdentity } from "../../../../lib/auth/identity";

/**
 * `GET /api/admin/backup` — the daily Notion export (ops hardening design spec
 * 2026-07-29 §3.3, §9.5).
 *
 * There was previously **no backup of the Notion data at all**: one deleted
 * database and ~100 machines of accumulated staff work is gone. This job reads
 * every configured Notion database and writes one timestamped JSON file to
 * private Vercel Blob storage, then prunes anything older than 30 days.
 *
 * **It never swallows a failure.** A backup that fails quietly is worse than no
 * backup, because you find out on the day you need it. Every error path returns
 * a non-200 so it lands in Vercel's cron log as a failed invocation, and the
 * body names the stage that broke.
 *
 * **The dump is PII.** Maintenance_Logs carries student names and reporter email
 * addresses, so the file is written to *private* blob storage only (`blob.ts`
 * hard-codes `access: "private"`) and belongs in whatever data inventory the
 * university keeps. It must never be made public or emailed around.
 *
 * Raw Notion pages are stored, not the app's mapped records: the mapping in
 * `notion.ts` is lossy by design (it picks the properties the site renders), and
 * a backup exists to restore what Notion had, not what the site showed.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 60;

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const NOTION_PAGE_SIZE = 100;

/** Bounds the pagination loop — 100 pages × 100 rows is far beyond any real database. */
const MAX_QUERY_PAGES = 100;

const BACKUP_PREFIX = "backups/";
const BACKUP_PATHNAME = /^backups\/(\d{4}-\d{2}-\d{2})\.json$/;
const RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Serialized file format. `version` is here so a future reader can tell what it has. */
interface BackupFile {
  version: 1;
  source: "notion";
  createdAt: string;
  databases: Record<
    string,
    { databaseId: string; pageCount: number; pages: unknown[] }
  >;
}

interface BackupTarget {
  /** `tools`, `maintenance_logs`, … — derived from the env var name. */
  table: string;
  envKey: string;
  databaseId: string | undefined;
}

/**
 * Every database the app knows about, taken from `notion.ts`'s env contract
 * rather than a second hard-coded list. That matters: when an eighth database is
 * added, it gets backed up automatically instead of being silently missed, which
 * is exactly the class of failure this route exists to prevent.
 *
 * `NOTION_DB_PROJECTS` is appended separately because it is optional and lives
 * outside the strict catalog contract (see `notion.ts`) — student project
 * submissions are staff-moderated work and are lost the same way everything else
 * is.
 */
function backupTargets(): BackupTarget[] {
  const catalogKeys = getNotionEnvContract().filter((key) =>
    key.startsWith("NOTION_DB_")
  );
  const keys = [...catalogKeys];
  if (process.env.NOTION_DB_PROJECTS && !keys.includes("NOTION_DB_PROJECTS")) {
    keys.push("NOTION_DB_PROJECTS");
  }

  return keys.map((envKey) => ({
    table: envKey.slice("NOTION_DB_".length).toLowerCase(),
    envKey,
    databaseId: process.env[envKey],
  }));
}

/**
 * Two accepted callers, matching §8: a person holding `ADMIN_REVALIDATE_SECRET`
 * (the same secret that guards `/api/admin/revalidate`) and Vercel Cron, which
 * sends `Authorization: Bearer $CRON_SECRET`.
 *
 * With neither secret set the route is *unconfigured*, not open — an
 * unauthenticated endpoint that dumps every student email is not a state to
 * degrade into.
 */
type AuthResult = "ok" | "unconfigured" | "forbidden";

function authorize(req: Request): AuthResult {
  const adminSecret = process.env.ADMIN_REVALIDATE_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  if (!adminSecret && !cronSecret) return "unconfigured";

  if (adminSecret && req.headers.get("x-admin-secret") === adminSecret) {
    return "ok";
  }
  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return "ok";
  }
  return "forbidden";
}

/**
 * Every row of one database, as Notion returned it. Throws on any non-OK
 * response: a partial dump written as if it were complete is a worse artifact
 * than no dump, so truncation is a failure rather than a degraded success.
 */
async function dumpDatabase(databaseId: string): Promise<unknown[]> {
  const pages: unknown[] = [];
  let startCursor: string | undefined;

  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const res = await fetch(`${NOTION_API_URL}/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({
        page_size: NOTION_PAGE_SIZE,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Notion query failed with status ${res.status}`);
    }

    const data = (await res.json()) as {
      results?: unknown[];
      next_cursor?: string | null;
    };
    pages.push(...(data.results ?? []));

    if (!data.next_cursor) return pages;
    startCursor = data.next_cursor;
  }

  throw new Error(`Notion query exceeded ${MAX_QUERY_PAGES} pages`);
}

/**
 * Backups older than the retention window, by the date in their own filename.
 * Anything that does not match the pattern is left alone — a prune step that
 * deletes files it does not recognise is a hazard, not a housekeeper.
 */
function expiredBackups(pathnames: string[], now: Date): string[] {
  return pathnames.filter((pathname) => {
    const match = BACKUP_PATHNAME.exec(pathname);
    if (!match) return false;
    const stamped = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (Number.isNaN(stamped)) return false;
    return (now.getTime() - stamped) / DAY_MS >= RETENTION_DAYS;
  });
}

/** Byte length, so the reported size is the file's rather than the string's. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export async function GET(req: Request) {
  const auth = authorize(req);
  if (auth === "unconfigured") {
    return Response.json(
      { ok: false, error: "backup is not configured" },
      { status: 503 }
    );
  }
  if (auth === "forbidden") {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Article 4: bound the expensive outbound work before doing any of it. The
  // route is secret-gated, so this is the second line — a leaked secret in a
  // loop would otherwise be one full Notion dump per request. Generous enough
  // that a daily cron plus a few manual retries never trips it.
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`backup:${identity.rateLimitKey}`, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!allowed) {
    return Response.json(
      { ok: false, error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  if (!process.env.NOTION_API_KEY) {
    return Response.json(
      { ok: false, error: "NOTION_API_KEY is not set" },
      { status: 503 }
    );
  }
  if (!isBlobConfigured()) {
    return Response.json(
      { ok: false, error: "BLOB_READ_WRITE_TOKEN is not set" },
      { status: 503 }
    );
  }

  const targets = backupTargets();
  const unconfigured = targets.filter((target) => !target.databaseId);
  if (unconfigured.length > 0) {
    // Refusing beats writing a file that is missing a database without saying
    // so — the restore would look complete and be wrong.
    return Response.json(
      {
        ok: false,
        error: `missing database ids: ${unconfigured
          .map((target) => target.envKey)
          .join(", ")}`,
      },
      { status: 503 }
    );
  }

  const now = new Date();
  const file: BackupFile = {
    version: 1,
    source: "notion",
    createdAt: now.toISOString(),
    databases: {},
  };

  // Sequential on purpose: eight databases once a day does not need fan-out,
  // and Notion's rate limit is the thing most likely to break this job.
  for (const target of targets) {
    try {
      const pages = await dumpDatabase(target.databaseId as string);
      file.databases[target.table] = {
        databaseId: target.databaseId as string,
        pageCount: pages.length,
        pages,
      };
    } catch (error) {
      console.error(`[backup] Notion dump failed for ${target.table}:`, error);
      return Response.json(
        {
          ok: false,
          stage: "notion",
          table: target.table,
          error: error instanceof Error ? error.message : "unknown error",
        },
        { status: 500 }
      );
    }
  }

  const pathname = `${BACKUP_PREFIX}${now.toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify(file);
  const store = getBlobStore();

  try {
    await store.put(pathname, body, "application/json");
  } catch (error) {
    console.error("[backup] blob write failed:", error);
    return Response.json(
      {
        ok: false,
        stage: "blob",
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 }
    );
  }

  // Retention runs in the same job so nobody has to remember it. A prune
  // failure still returns non-200, but reports `written: true` so whoever reads
  // the cron log knows today's data is safe and only cleanup needs attention.
  let pruned: string[] = [];
  try {
    const existing = await store.list(BACKUP_PREFIX);
    pruned = expiredBackups(
      existing.map((blob) => blob.pathname),
      now
    );
    await store.del(pruned);
  } catch (error) {
    console.error("[backup] prune failed:", error);
    return Response.json(
      {
        ok: false,
        stage: "prune",
        written: true,
        pathname,
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 }
    );
  }

  return Response.json({
    ok: true,
    pathname,
    bytes: byteLength(body),
    retentionDays: RETENTION_DAYS,
    databases: Object.fromEntries(
      Object.entries(file.databases).map(([table, entry]) => [
        table,
        entry.pageCount,
      ])
    ),
    pruned,
  });
}
