import { start } from "workflow/api";
import { mirrorPush, mirrorPushAfterChange } from "../../workflows/mirror-push.ts";
import { claimManualSync, releaseManualSync } from "../data/mirrors.ts";
import type { Db } from "../db/types.ts";
import { scrubSecrets } from "./notion-client.ts";

/**
 * Starting the mirror's workflows (spec §3.8 "Triggers", §8 rate limiting).
 *
 * The one module that imports `workflow/api` for the mirror. Everything that
 * reaches it on an ordinary request does so through a dynamic `import()` in
 * `trigger.ts`, taken only once a push has actually been claimed — so the
 * inventory, intake and projects actions do not load the workflow runtime to
 * find out that nobody has a mirror.
 *
 * **Starting is not pushing.** Each function answers whether the run was
 * *started*; what the push did is on the mirror row once it has run, and
 * `/admin/mirror` polls for it.
 *
 * Log lines carry the mirror id and a scrubbed reason, never a token or an
 * email.
 */

/** Start `mirrorPush(mirrorId)`. `{ ok: false }` when the workflow could not be started. */
export async function startMirrorPush(mirrorId: string): Promise<{ ok: true; runId: string } | { ok: false }> {
  try {
    const run = await start(mirrorPush, [mirrorId]);
    return { ok: true, runId: run.runId };
  } catch (error) {
    console.error(`[mirror] could not start a push for mirror ${mirrorId}: ${reason(error)}`);
    return { ok: false };
  }
}

export type SyncNowResult =
  | { ok: true }
  | {
      ok: false;
      code: "not_connected" | "not_mapped" | "mirror_paused" | "sync_too_soon" | "sync_running" | "start_failed";
      retryAfterSeconds?: number;
    };

/**
 * **Sync now** (§3.8 control, §8: "one push per mirror per 15 minutes").
 *
 * The limit lives in the database, not in this process: `claimManualSync` is
 * one conditional update on `sync_requested_at`, so two presses from two tabs,
 * or two server instances, cannot both pass it. A claim whose workflow then
 * fails to start is given back (`releaseManualSync`), because a push that
 * never ran must not spend the owner's fifteen minutes — they press again and
 * it works.
 *
 * The mirror is always found from the owner: the caller passes the session's
 * user id, never a mirror id from the page. A database failure throws; the
 * server action turns it into its own `failed`.
 */
export async function syncMirrorNow(ownerUserId: string, options: { db?: Db } = {}): Promise<SyncNowResult> {
  const claim = await claimManualSync(ownerUserId, { db: options.db });
  if (!claim.ok) {
    switch (claim.reason) {
      case "not_found":
      case "not_connected":
        return { ok: false, code: "not_connected" };
      case "paused":
        return { ok: false, code: "mirror_paused" };
      case "not_mapped":
        return { ok: false, code: "not_mapped" };
      case "too_soon":
        return { ok: false, code: "sync_too_soon", retryAfterSeconds: claim.retryAfterSeconds };
      case "running":
        // Another push holds the mirror. Refused without spending the window:
        // a push started now would be skipped, and the page would report the
        // other push's result as this press's.
        return { ok: false, code: "sync_running" };
    }
  }

  const started = await startMirrorPush(claim.mirrorId);
  if (started.ok) return { ok: true };

  try {
    await releaseManualSync(claim.mirrorId, { db: options.db });
  } catch {
    // The claim stays, and the owner waits out the window. Still a failure to
    // start, and still said so — never a success over a push that is not
    // happening (Article 4).
    console.error(`[mirror] could not release the Sync now claim on mirror ${claim.mirrorId}`);
  }
  return { ok: false, code: "start_failed" };
}

/**
 * Start `mirrorPushAfterChange()` — the coalescing run (§3.8 trigger 1). False
 * when it could not be started; `requestMirrorPush` then gives the claims back.
 */
export async function startCoalescedPush(): Promise<boolean> {
  try {
    await start(mirrorPushAfterChange, []);
    return true;
  } catch (error) {
    console.error(`[mirror] could not start the coalesced push: ${reason(error)}`);
    return false;
  }
}

/** Why a start failed, in one short line with nothing token- or email-shaped in it. */
function reason(error: unknown): string {
  const message = error instanceof Error ? error.message || error.name : "unknown error";
  const oneLine = scrubSecrets(message).replace(/\s+/g, " ").trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 199)}…` : oneLine;
}
