import { getBlobStore, isBlobConfigured } from "../blob";
import { BACKUP_PREFIX } from "./backup";

/**
 * Is the nightly backup still landing? (ops hardening spec amendment
 * 2026-09-27 "Cron failures are no longer silent".) `/admin` asks this for a
 * super admin, so a job that has stopped shows on the page somebody opens
 * anyway rather than only in Vercel's cron log.
 *
 * The evidence is the files themselves, not a record of runs: a green run
 * that wrote nothing is still a missing backup.
 */

/** The job runs every 24 hours; 36 allows a late run without crying wolf. */
export const BACKUP_STALE_AFTER_HOURS = 36;

const BACKUP_PATHNAME = /^backups\/(\d{4}-\d{2}-\d{2})\.json$/;
const HOUR_MS = 60 * 60 * 1000;

export type BackupFreshness =
  | { state: "fresh"; latestAt: string }
  | { state: "stale"; latestAt: string }
  | { state: "missing" }
  | { state: "no_store" }
  | { state: "unreadable" };

/**
 * The newest backup, by when it was written (`uploadedAt`, falling back to
 * the midnight its name gives), judged against {@link BACKUP_STALE_AFTER_HOURS}.
 * Pure; pathnames that are not backups are ignored.
 */
export function backupFreshness(
  blobs: readonly { pathname: string; uploadedAt?: string }[],
  now: Date
): BackupFreshness {
  let latest: number | null = null;
  for (const blob of blobs) {
    const match = BACKUP_PATHNAME.exec(blob.pathname);
    if (!match) continue;
    const uploaded = Date.parse(blob.uploadedAt ?? "");
    const at = Number.isNaN(uploaded) ? Date.parse(`${match[1]}T00:00:00.000Z`) : uploaded;
    if (Number.isNaN(at)) continue;
    if (latest === null || at > latest) latest = at;
  }
  if (latest === null) return { state: "missing" };
  const latestAt = new Date(latest).toISOString();
  return now.getTime() - latest > BACKUP_STALE_AFTER_HOURS * HOUR_MS
    ? { state: "stale", latestAt }
    : { state: "fresh", latestAt };
}

/** One Blob `list` of `backups/`. Never throws: a failed read is its own state. */
export async function loadBackupFreshness(now = new Date()): Promise<BackupFreshness> {
  if (!isBlobConfigured()) return { state: "no_store" };
  try {
    return backupFreshness(await getBlobStore().list(BACKUP_PREFIX, "private"), now);
  } catch (error) {
    console.warn("[admin] could not list backups:", error instanceof Error ? error.message : "unknown error");
    return { state: "unreadable" };
  }
}
