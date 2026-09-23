"use client";

import "../../styles/admin-mirror.css";

import { useId, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import type { AdminActionWarning } from "../../lib/admin/action-result";
import type { MirrorView } from "../../lib/mirror/types";
import {
  mirrorErrorMessageKey,
  type MirrorActionError,
  type MirrorActionResult,
  type MirrorActions,
} from "../../app/admin/mirror/action-result";
import { useRefreshNudge } from "./use-refresh-nudge";

/**
 * **Sync now**, **Pause** / **Resume** and **Disconnect** (spec §3.8
 * "Controls", §8).
 *
 * **Sync now says why it cannot.** One push per mirror per 15 minutes (§8), so
 * after a sync the button is disabled with the reason and the time left beside
 * it — computed from `syncAvailableAt`, which Postgres worked out against the
 * same clock the claim will refuse on. A paused mirror, a mirror with no
 * databases and a push already running each disable it with their own reason.
 * The server still checks every one of these; the button is presentation.
 *
 * **Nothing here claims a success it did not get** (Article 4). Every message
 * follows the awaited result: a refusal shows `admin.mirror.errors.<code>` (or
 * the gate's `admin.errors.<code>`), a lost audit event shows its warning, and
 * the page's re-render after `revalidatePath` is what moves the controls on
 * (with `useRefreshNudge`, so that re-render is committed). No
 * `useTransition`, so the confirmation is never held hostage by that
 * re-render (the `/admin/users` lesson).
 *
 * **Disconnect asks first, inline** — never a modal — and says what it keeps.
 */

export type MirrorControlActions = Pick<MirrorActions, "syncNow" | "setPaused" | "disconnect">;

export interface MirrorControlsProps {
  view: MirrorView;
  actions: MirrorControlActions;
}

type Busy = "sync" | "pause" | "disconnect" | null;
type Done = "syncStarted" | "pausedDone" | "resumedDone" | null;

/** How often the "available again in" line re-reads the clock. */
const CLOCK_TICK_MS = 15_000;

function subscribeClock(onTick: () => void): () => void {
  const timer = setInterval(onTick, CLOCK_TICK_MS);
  return () => clearInterval(timer);
}

/** Quantised, so the snapshot is stable between ticks as React requires. */
function readClock(): number {
  return Math.floor(Date.now() / CLOCK_TICK_MS) * CLOCK_TICK_MS;
}

/** No clock on the server: the first render says "not yet" without a number, then hydrates one in. */
function readServerClock(): number | null {
  return null;
}

export function MirrorControls({ view, actions }: MirrorControlsProps) {
  const t = useTranslations("admin");
  const now = useSyncExternalStore(subscribeClock, readClock, readServerClock);
  const reasonId = useId();
  const nudge = useRefreshNudge();

  const [busy, setBusy] = useState<Busy>(null);
  const [done, setDone] = useState<Done>(null);
  const [error, setError] = useState<MirrorActionError | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);
  const [confirming, setConfirming] = useState(false);

  const mapped = Object.keys(view.mapping).length > 0;
  const availableAt = view.syncAvailableAt ? Date.parse(view.syncAvailableAt) : null;
  // Before hydration there is no clock, so the server's own answer stands: a
  // `syncAvailableAt` at all means "not yet".
  const windowClosed = availableAt !== null && (now === null || availableAt > now);
  const minutesLeft =
    availableAt !== null && now !== null ? Math.max(1, Math.ceil((availableAt - now) / 60_000)) : null;

  let syncReason: string | null = null;
  if (view.paused) syncReason = t("mirror.controls.syncNeedsResume");
  else if (!mapped) syncReason = t("mirror.controls.syncNeedsMapping");
  else if (windowClosed) {
    syncReason =
      minutesLeft !== null
        ? `${t("mirror.controls.syncLimit")} ${t("mirror.controls.syncAvailableIn", { minutes: minutesLeft })}`
        : t("mirror.controls.syncLimit");
  } else if (view.running) syncReason = t("mirror.controls.syncRunning");

  async function perform(which: Exclude<Busy, null>, success: Done, call: () => Promise<MirrorActionResult>) {
    setBusy(which);
    setDone(null);
    setError(null);
    setRetryAfterSeconds(null);
    setWarning(null);
    try {
      const result = await call();
      if (result.ok) {
        setDone(success);
        setWarning(result.warning ?? null);
        // The page re-renders with the change; see `use-refresh-nudge.ts`.
        nudge();
        return true;
      }
      setError(result.error);
      setRetryAfterSeconds(result.retryAfterSeconds ?? null);
      return false;
    } catch {
      setError("failed");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    const ok = await perform("disconnect", null, () => actions.disconnect());
    if (ok) setConfirming(false);
  }

  return (
    <section className="admin-mirror-panel" aria-label={t("mirror.controls.label")}>
      <div className="admin-mirror-actions">
        <button
          type="button"
          className="admin-button is-primary"
          disabled={busy !== null || syncReason !== null || !view.connected}
          aria-describedby={syncReason ? reasonId : undefined}
          onClick={() => void perform("sync", "syncStarted", () => actions.syncNow())}
        >
          {busy === "sync" ? t("mirror.controls.syncing") : t("mirror.controls.syncNow")}
        </button>
        <button
          type="button"
          className="admin-button"
          disabled={busy !== null}
          onClick={() =>
            void perform("pause", view.paused ? "resumedDone" : "pausedDone", () =>
              actions.setPaused({ paused: !view.paused })
            )
          }
        >
          {busy === "pause"
            ? t("mirror.controls.working")
            : view.paused
              ? t("mirror.controls.resume")
              : t("mirror.controls.pause")}
        </button>
        {view.connected && !confirming ? (
          <button
            type="button"
            className="admin-button is-danger"
            disabled={busy !== null}
            onClick={() => setConfirming(true)}
          >
            {t("mirror.controls.disconnect")}
          </button>
        ) : null}
      </div>

      {syncReason ? (
        <p id={reasonId} className="admin-mirror-line">
          {syncReason}
        </p>
      ) : null}

      {confirming ? (
        <div className="admin-mirror-confirm">
          <p>{t("mirror.controls.disconnectConfirm")}</p>
          <button
            type="button"
            className="admin-button is-danger"
            disabled={busy !== null}
            onClick={() => void disconnect()}
          >
            {busy === "disconnect" ? t("mirror.controls.working") : t("mirror.controls.disconnectYes")}
          </button>
          <button
            type="button"
            className="admin-button"
            disabled={busy !== null}
            onClick={() => setConfirming(false)}
          >
            {t("mirror.controls.disconnectNo")}
          </button>
        </div>
      ) : null}

      <p
        className={`admin-mirror-line${error ? " is-error" : warning ? " is-warning" : done ? " is-ok" : ""}`}
        role="status"
      >
        {error
          ? [
              t(mirrorErrorMessageKey(error)),
              retryAfterSeconds !== null
                ? t("mirror.controls.syncAvailableIn", { minutes: Math.max(1, Math.ceil(retryAfterSeconds / 60)) })
                : null,
            ]
              .filter(Boolean)
              .join(" ")
          : warning
            ? t(`warnings.${warning}`)
            : done
              ? t(`mirror.controls.${done}`)
              : null}
      </p>
    </section>
  );
}
