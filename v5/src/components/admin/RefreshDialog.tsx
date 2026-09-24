"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { QueueRefreshAction, QueueRefreshResult } from "../../app/admin/refresh/action-result";
import { RESEARCH_MAX_ITEMS_PER_REQUEST, REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import "../../styles/admin-refresh.css";

/**
 * **Refresh research (N)** (refresh research spec §5.1, §6): an inline panel
 * over the inventory, not a modal (the admin palette's rule). It asks whether
 * to propose description rewrites (off by default) and, for one tool, for an
 * optional note; then queues and says what happened — how many started, how
 * many were skipped because they already had a refresh open, or that the day's
 * allowance would be passed — with a link to the Refresh page.
 */

export interface RefreshDialogProps {
  toolIds: string[];
  action: QueueRefreshAction;
  onClose: () => void;
  /** Called after a press that queued something, so the island can clear its selection. */
  onQueued?: () => void;
}

export function RefreshDialog({ toolIds, action, onClose, onQueued }: RefreshDialogProps) {
  const t = useTranslations("admin.refresh");
  const te = useTranslations("admin.errors");
  const [descriptions, setDescriptions] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<QueueRefreshResult | null>(null);
  const [pending, startTransition] = useTransition();
  const count = toolIds.length;
  const tooMany = count > RESEARCH_MAX_ITEMS_PER_REQUEST;

  function start() {
    startTransition(async () => {
      const outcome = await action({
        toolIds,
        includeDescription: descriptions,
        note: count === 1 && note.trim() ? note.trim() : null,
      });
      setResult(outcome);
      if (outcome.ok && outcome.queued > 0) onQueued?.();
    });
  }

  return (
    <section className="admin-refresh-dialog" aria-label={t("dialogTitle")}>
      <h3>{t("dialogTitle")}</h3>
      <p>{t("dialogBody", { count })}</p>

      {result ? (
        <div role="status">
          {result.ok ? (
            <>
              {result.queued > 0 ? <p>{t("dialogStarted", { count: result.queued })}</p> : null}
              {result.skipped > 0 ? <p>{t("dialogSkipped", { count: result.skipped })}</p> : null}
              <p>
                <Link href="/admin/refresh">{t("goToRefresh")}</Link>
              </p>
            </>
          ) : (
            <p className="admin-row-status is-error">
              {result.error === "daily_limit" ? t("dialogLimit", { remaining: result.remaining ?? 0 }) : te(result.error)}
            </p>
          )}
          <div className="admin-editor-actions">
            <button type="button" className="admin-button" onClick={onClose}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <label className="admin-field is-check">
            <input type="checkbox" checked={descriptions} onChange={(event) => setDescriptions(event.target.checked)} />
            <span>{t("dialogDescriptions")}</span>
          </label>
          {count === 1 ? (
            <label className="admin-field">
              <span>{t("dialogNote")}</span>
              <textarea
                rows={2}
                value={note}
                maxLength={REVIEWER_NOTE_MAX_CHARS}
                placeholder={t("againNotePlaceholder")}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          ) : null}
          {tooMany ? <p className="admin-row-status is-error">{te("too_many_tools")}</p> : null}
          <div className="admin-editor-actions">
            <button type="button" className="admin-button is-primary" disabled={pending || tooMany || count === 0} onClick={start}>
              {pending ? t("saving") : t("dialogStart", { count })}
            </button>
            <button type="button" className="admin-button" onClick={onClose} disabled={pending}>
              {t("cancel")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
