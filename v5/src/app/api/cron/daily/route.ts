import { getBlobStore, isBlobConfigured } from "../../../../lib/blob";
import { runBackup } from "../../../../lib/cron/backup";
import { runCleanup } from "../../../../lib/cron/cleanup";
import { rateLimitAsync } from "../../../../lib/rate-limit";
import { resolveIdentity } from "../../../../lib/auth/identity";

/**
 * `GET /api/cron/daily` — the one scheduled job (data platform design spec
 * §3.9).
 *
 * It replaces `GET /api/admin/backup`, which dumped Notion. Hobby allows a
 * cron at most once a day, so everything nightly shares this one entry in
 * `vercel.json`:
 *
 * 1. **Backup** — a JSON export of every Postgres table to a private blob,
 *    kept 30 days.
 * 2. **Cleanup** — uploads nobody claimed within 24 hours, removed from Blob
 *    and from `attachments`.
 *
 * Mirror pushes (§3.8) and pending-tool expiry (§4.10) join this list in later
 * phases; neither has a writer yet.
 *
 * **Nothing here fails quietly.** Both stages report, and either one failing
 * makes the whole invocation non-200 so it shows in Vercel's cron log as
 * failed. A backup that silently stopped running is the thing this route was
 * built to prevent.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 60;

/**
 * Two accepted callers, carried over from `/api/admin/backup` rather than
 * quietly dropped: Vercel Cron, which sends `Authorization: Bearer
 * $CRON_SECRET`, and a person holding `ADMIN_REVALIDATE_SECRET` — the
 * hand-trigger `docs/deploy.md` documents for the first run after a deploy.
 *
 * With neither secret set the route is **unconfigured, not open**. An
 * unauthenticated endpoint that dumps every student email is not a state to
 * degrade into, so it refuses and says which variable is missing (Article 4).
 */
type AuthResult = "ok" | "unconfigured" | "forbidden";

function authorize(req: Request): AuthResult {
  const cronSecret = process.env.CRON_SECRET;
  const adminSecret = process.env.ADMIN_REVALIDATE_SECRET;
  if (!cronSecret && !adminSecret) return "unconfigured";

  if (cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`) {
    return "ok";
  }
  if (adminSecret && req.headers.get("x-admin-secret") === adminSecret) {
    return "ok";
  }
  return "forbidden";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

export async function GET(req: Request) {
  const auth = authorize(req);
  if (auth === "unconfigured") {
    return Response.json(
      { ok: false, error: "cron is not configured: CRON_SECRET is not set" },
      { status: 503 }
    );
  }
  if (auth === "forbidden") {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  // Article 4: bound the expensive work before doing any of it. The route is
  // secret-gated, so this is the second line — a leaked secret in a loop would
  // otherwise be one full database dump per request. Generous enough that a
  // daily cron plus a few manual retries never trips it.
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`cron:${identity.rateLimitKey}`, {
    limit: 10,
    windowMs: 60 * 60_000,
  });
  if (!allowed) {
    return Response.json(
      { ok: false, error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  if (!isBlobConfigured()) {
    return Response.json(
      { ok: false, error: "BLOB_READ_WRITE_TOKEN is not set" },
      { status: 503 }
    );
  }

  const store = getBlobStore();

  let backup: Awaited<ReturnType<typeof runBackup>>;
  try {
    backup = await runBackup(store);
  } catch (error) {
    console.error("[cron] backup failed:", error);
    return Response.json(
      { ok: false, stage: "backup", error: message(error) },
      { status: 500 }
    );
  }

  // Cleanup runs second and reports separately: today's data is already safe,
  // so a sweep that fails is worth a failed invocation but not a lost backup —
  // whoever reads the log needs to be able to tell those apart.
  try {
    const cleanup = await runCleanup(store);
    return Response.json({ ok: true, backup, cleanup });
  } catch (error) {
    console.error("[cron] cleanup failed:", error);
    return Response.json(
      { ok: false, stage: "cleanup", backup, error: message(error) },
      { status: 500 }
    );
  }
}
