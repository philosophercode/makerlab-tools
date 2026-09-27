/**
 * The nightly job's dead-man's switch (ops hardening spec amendment 2026-09-27
 * "Cron failures are no longer silent").
 *
 * Vercel records a failed cron invocation in its log and tells nobody. A
 * heartbeat monitor — Healthchecks.io or Better Stack, both free — inverts
 * that: it expects a ping every day and emails when one is missing or says
 * `fail`. That catches the failures a status code cannot: the cron never
 * firing at all, a Root Directory change that unregistered it, a function that
 * timed out before answering.
 *
 * `CRON_HEARTBEAT_URL` is the monitor's ping URL. Unset, this does nothing.
 * Both services accept `<url>/fail` as an explicit failure signal.
 *
 * **It never fails the job.** A monitor that is down must not turn a good
 * backup into a 500, so every error is logged and swallowed. The URL is a
 * credential (anyone holding it can mark the job healthy), so it is never
 * logged.
 */

const HEARTBEAT_TIMEOUT_MS = 5_000;

export async function reportHeartbeat(ok: boolean): Promise<void> {
  const base = process.env.CRON_HEARTBEAT_URL?.trim();
  if (!base) return;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    console.warn("[cron] CRON_HEARTBEAT_URL is not a URL; heartbeat skipped");
    return;
  }
  if (url.protocol !== "https:") {
    console.warn("[cron] CRON_HEARTBEAT_URL must be https; heartbeat skipped");
    return;
  }
  if (!ok) url.pathname = `${url.pathname.replace(/\/$/, "")}/fail`;

  try {
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
    });
    if (!res.ok) console.warn(`[cron] heartbeat answered ${res.status}`);
  } catch (error) {
    console.warn("[cron] heartbeat failed:", error instanceof Error ? error.name : "unknown error");
  }
}
