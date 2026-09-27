import { getBlobStore, isBlobConfigured, type BlobStore } from "../../../../lib/blob";
import { runBackup } from "../../../../lib/cron/backup";
import { runCleanup } from "../../../../lib/cron/cleanup";
import { reportHeartbeat } from "../../../../lib/cron/heartbeat";
import { runManualArchiveBackfill } from "../../../../lib/cron/manual-archive";
import { runMirrorBackstop } from "../../../../lib/cron/mirror-backstop";
import { runPendingExpiry } from "../../../../lib/cron/pending-expiry";
import { rateLimitAsync } from "../../../../lib/rate-limit";
import { resolveIdentity } from "../../../../lib/auth/identity";

/**
 * `GET /api/cron/daily` — the one scheduled job (data platform design spec
 * §3.9, §4.10).
 *
 * It replaced a nightly Notion dump (the retired `/api/admin/backup`). Hobby
 * allows a cron at most once a day, so everything nightly shares this one
 * entry in `vercel.json`:
 *
 * 1. **Backup** — a JSON export of every Postgres table (bar credentials and
 *    the rebuildable manual search tables) to a private blob, kept on tiers:
 *    daily for a week, then weekly, monthly and quarterly to three years
 *    (`src/lib/cron/backup-retention.ts`).
 * 2. **Pending-tool expiry** (Phase 6) — items left `identified` more than 14
 *    days discarded, their photos released; items an abandoned research run
 *    has held for more than a day marked `failed`, so a person can act on
 *    them.
 * 3. **Cleanup** — uploads nobody claimed within 24 hours, removed from Blob
 *    and from `attachments`. This is also where stage 2's released photos
 *    actually leave Blob: they are unowned and, by the time an item has sat
 *    `identified` for two weeks, always well past the 24-hour orphan window —
 *    so a photo an expired item held is deleted from Blob and from the table
 *    in this same run (§4.10 "its attachments deleted").
 * 4. **Mirror backstop** (Phase 8) — a `mirrorPush` workflow started for every
 *    active Notion mirror whose data is newer than its last sync, or whose
 *    last push was not `ok` (§3.8 trigger 3). The stage only starts the runs;
 *    each pushes in its own workflow, outside this function's 60 seconds. A
 *    run that could not be started fails the stage, as a throw does.
 * 5. **Manual archive backfill** — up to ten Manual resources whose link has
 *    no PDF copy in Blob yet, handed to one `archiveManuals` run
 *    (`src/lib/cron/manual-archive.ts`). Backfills imported manuals over time
 *    and catches any approval whose run never started. Like the mirror stage
 *    it only starts the run, and a run that could not be started fails the
 *    stage.
 *
 * **Nothing here fails quietly.** Every stage reports, and any one failing
 * makes the whole invocation non-200 so it shows in Vercel's cron log as
 * failed. A backup that silently stopped running is the thing this route was
 * built to prevent. Vercel's log tells nobody, though, so each run also pings
 * `CRON_HEARTBEAT_URL` — `<url>` on success, `<url>/fail` otherwise — and the
 * heartbeat monitor emails when a ping fails or never arrives
 * (`src/lib/cron/heartbeat.ts`, `docs/operations.md`).
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 60;

/**
 * Two accepted callers, carried over from the retired Notion backup route
 * rather than quietly dropped: Vercel Cron, which sends `Authorization: Bearer
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

  // Every run that got past the gates reports to the heartbeat monitor, good
  // or bad. A refused caller does not: a stranger must not be able to mark
  // the job failed, or (with a leaked secret) healthy.
  const response = isBlobConfigured()
    ? await runStages(getBlobStore())
    : Response.json(
        { ok: false, error: "No Blob store is linked (BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID)" },
        { status: 503 }
      );
  await reportHeartbeat(response.ok);
  return response;
}

/** The five stages, in order; the first to fail answers for the run. */
async function runStages(store: BlobStore): Promise<Response> {
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

  // Expiry runs second, before the sweep that deletes what it releases (see
  // the docstring above), and reports separately for the same reason cleanup
  // always has: today's backup already landed, so this stage failing is worth
  // a failed invocation but not a lost backup.
  let pendingExpiry: Awaited<ReturnType<typeof runPendingExpiry>>;
  try {
    pendingExpiry = await runPendingExpiry();
  } catch (error) {
    console.error("[cron] pending-tool expiry failed:", error);
    return Response.json(
      { ok: false, stage: "pendingExpiry", backup, error: message(error) },
      { status: 500 }
    );
  }

  let cleanup: Awaited<ReturnType<typeof runCleanup>>;
  try {
    cleanup = await runCleanup(store);
  } catch (error) {
    console.error("[cron] cleanup failed:", error);
    return Response.json(
      { ok: false, stage: "cleanup", backup, pendingExpiry, error: message(error) },
      { status: 500 }
    );
  }

  // Last, because it is the least urgent and the only stage that hands work
  // to something else: every earlier stage has landed, and reports, whatever
  // happens here.
  let mirror: Awaited<ReturnType<typeof runMirrorBackstop>>;
  try {
    mirror = await runMirrorBackstop();
  } catch (error) {
    console.error("[cron] mirror backstop failed:", error);
    return Response.json(
      { ok: false, stage: "mirror", backup, pendingExpiry, cleanup, error: message(error) },
      { status: 500 }
    );
  }
  if (mirror.failed > 0) {
    // The ids and the reasons are already in the log (`start.ts`); the body
    // says how many, so the cron log shows a failed invocation.
    return Response.json(
      {
        ok: false,
        stage: "mirror",
        backup,
        pendingExpiry,
        cleanup,
        mirror,
        error: `${mirror.failed} mirror push(es) could not be started`,
      },
      { status: 500 }
    );
  }

  // After the mirror, for the same reason it is after everything else: it only
  // hands work to a workflow, and every earlier stage has already reported.
  let manuals: Awaited<ReturnType<typeof runManualArchiveBackfill>>;
  try {
    manuals = await runManualArchiveBackfill();
  } catch (error) {
    console.error("[cron] manual archive backfill failed:", error);
    return Response.json(
      { ok: false, stage: "manuals", backup, pendingExpiry, cleanup, mirror, error: message(error) },
      { status: 500 }
    );
  }
  if (manuals.failed > 0) {
    return Response.json(
      {
        ok: false,
        stage: "manuals",
        backup,
        pendingExpiry,
        cleanup,
        mirror,
        manuals,
        error: "the manual archive run could not be started",
      },
      { status: 500 }
    );
  }

  return Response.json({ ok: true, backup, pendingExpiry, cleanup, mirror, manuals });
}
