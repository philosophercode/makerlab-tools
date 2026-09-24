"use client";

import "../../styles/admin-mirror.css";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { MIRROR_ENTITY, MIRROR_STATUS, type MirrorEntity } from "../../lib/db/schema/vocabulary";
import { MIRROR_POLL_INTERVAL_MS } from "../../lib/mirror/limits";
import { MIRROR_ERROR_CODES, type MirrorErrorCode, type MirrorView } from "../../lib/mirror/types";

/**
 * What the mirror last did, and what it is doing now (spec §3.8 "Status",
 * §5.8, §6).
 *
 * Last synced, last run, last result and the last error — the error in the
 * page's words (`admin.mirror.lastError.<code>`), with the tables it concerned
 * and Notion's own scrubbed sentence under it, because whoever fixes a mirror
 * needs to know *which* database somebody deleted. Paused, running, a Sync now
 * waiting to start and a push scheduled after recent edits are each said
 * outright rather than left to be inferred from timestamps.
 *
 * **It polls while a push is running or requested, and only then** — as
 * `IntakeList` does. The push happens in a workflow the page cannot subscribe
 * to, so it asks for a fresh render every `MIRROR_POLL_INTERVAL_MS`; the
 * interval is cleared the moment neither is true, and on unmount.
 *
 * **Times are formatted by next-intl in the lab's time zone**, passed in by
 * the page, never with `Date.toLocaleString()` and never in whatever zone the
 * server or the browser happens to be in — so the server's render and the
 * browser's agree, and "last synced" means the same hour to everyone reading it.
 */

export interface MirrorStatusProps {
  view: MirrorView;
  /** An IANA zone (`LAB_TIMEZONE`), so server and browser render the same time. */
  timeZone: string;
}

export function MirrorStatus({ view, timeZone }: MirrorStatusProps) {
  const t = useTranslations("admin.mirror");
  const format = useFormatter();
  const router = useRouter();

  const polling = view.running || view.syncPending;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => router.refresh(), MIRROR_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [polling, router]);

  function when(iso: string | null) {
    if (!iso) return <span className="admin-mirror-unset">{t("status.never")}</span>;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return <span className="admin-mirror-unset">{t("status.never")}</span>;
    return (
      <time dateTime={iso}>{format.dateTime(date, { dateStyle: "medium", timeStyle: "short", timeZone })}</time>
    );
  }

  const status = view.lastStatus && MIRROR_STATUS.includes(view.lastStatus) ? view.lastStatus : null;
  const error = view.lastError;
  const errorCode: MirrorErrorCode =
    error && (MIRROR_ERROR_CODES as readonly string[]).includes(error.code) ? error.code : "unknown";
  const errorEntities = (error?.entities ?? []).filter((entity): entity is MirrorEntity =>
    (MIRROR_ENTITY as readonly string[]).includes(entity)
  );

  return (
    <section className="admin-mirror-panel" aria-labelledby="mirror-status-title">
      <h3 id="mirror-status-title">{t("status.title")}</h3>

      <p className="admin-mirror-line">
        {/* A disconnected mirror keeps its page and mapping, but saying
            "Connected" over a forgotten token would be the lie Article 4 is about. */}
        {view.connected
          ? view.parentPageTitle
            ? t("connectedTo", { title: view.parentPageTitle })
            : t("connectedToUntitled")
          : view.parentPageTitle
            ? t("disconnectedFrom", { title: view.parentPageTitle })
            : t("disconnectedFromUntitled")}
      </p>

      <ul className="admin-mirror-flags" aria-live="polite">
        {view.paused ? <li className="admin-mirror-flag is-paused">{t("status.paused")}</li> : null}
        {view.running ? <li className="admin-mirror-flag">{t("status.running")}</li> : null}
        {!view.running && view.syncPending ? (
          <li className="admin-mirror-flag">{t("status.syncPending")}</li>
        ) : null}
        {view.pushScheduled && !view.paused ? (
          <li className="admin-mirror-flag">{t("status.scheduled")}</li>
        ) : null}
      </ul>

      <dl className="admin-mirror-facts">
        <div>
          <dt>{t("status.lastSynced")}</dt>
          <dd>
            {when(view.lastSyncedAt)}
            {/* The stored time is the push's safety watermark — a few minutes
                before the push started — so say what it guarantees rather
                than let it read as a clock that is wrong by five minutes. */}
            {view.lastSyncedAt ? <span className="admin-mirror-hint"> {t("status.lastSyncedHint")}</span> : null}
          </dd>
        </div>
        <div>
          <dt>{t("status.lastRun")}</dt>
          <dd>{when(view.lastRunAt)}</dd>
        </div>
        <div>
          <dt>{t("status.lastResult")}</dt>
          <dd>
            {status ? (
              <span className={`admin-mirror-result is-${status}`}>{t(`status.result.${status}`)}</span>
            ) : (
              <span className="admin-mirror-unset">{t("status.noResult")}</span>
            )}
          </dd>
        </div>
      </dl>

      {!view.lastSyncedAt && !view.lastRunAt && !view.running && !view.syncPending ? (
        <p className="admin-mirror-hint">{t("status.neverSynced")}</p>
      ) : null}

      {error ? (
        <div className={`admin-mirror-error${status === "partial" ? " is-partial" : ""}`}>
          <span className="admin-mirror-error-label">{t("status.lastError")}</span>
          <p>{t(`lastError.${errorCode}`)}</p>
          {errorEntities.length > 0 ? (
            <p>
              {t("status.errorEntities", {
                names: format.list(errorEntities.map((entity) => t(`entities.${entity}`))),
              })}
            </p>
          ) : null}
          {error.failed > 0 ? <p>{t("status.errorFailed", { count: error.failed })}</p> : null}
          {error.detail ? (
            <p>
              <span className="admin-mirror-error-label">{t("status.errorDetail")}</span>{" "}
              <span className="admin-mirror-detail">{error.detail}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
