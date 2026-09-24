"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { RefreshActionError, RefreshReviewActions, RefreshWarning } from "../../app/admin/refresh/action-result";
import type { RefreshStatus } from "../../lib/db/schema/vocabulary";
import { INTAKE_POLL_INTERVAL_MS, REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import { isAcceptable, isActionable, isUndecided, type FieldProposal } from "../../lib/refresh/types";
import { ProposalCard } from "./ProposalCard";
import "../../styles/admin-refresh.css";

/**
 * One refresh's review (refresh research spec §5.2, §6): the proposal cards,
 * safety first, and the page's own controls. Every write is a server action
 * handed down by the page; after each, the page is re-rendered, because the
 * cards' decisions and the row revision the next action compares against both
 * live on the server.
 *
 * A conflict (the tool was edited since the refresh was queued) is said once
 * above the cards; the affected cards come back marked "Changed since" with the
 * record's value now, to be decided again.
 */

export interface RefreshReviewView {
  id: string;
  status: RefreshStatus;
  rowRevision: string;
  tool: { id: string; name: string; slug: string; published: boolean; archived: boolean };
  proposals: FieldProposal[];
  note: string | null;
  includeDescription: boolean;
  researchError: string | null;
  categorySuggestion: string | null;
  duplicateOf: { name: string; slug: string } | null;
  canPublish: boolean;
}

type Message = { kind: "ok" | "error" | "warning"; text: string } | null;

export function RefreshReview({ view, actions }: { view: RefreshReviewView; actions: RefreshReviewActions }) {
  const t = useTranslations("admin.refresh");
  const tp = useTranslations("admin.proposal");
  const te = useTranslations("admin.errors");
  const tw = useTranslations("admin.warnings");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message>(null);
  const [againOpen, setAgainOpen] = useState(false);
  const [note, setNote] = useState("");
  const [descriptions, setDescriptions] = useState(view.includeDescription);

  const running = view.status === "queued" || view.status === "researching";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), INTAKE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  const actionable = view.proposals.filter(isActionable);
  const notFound = view.proposals.filter((p) => !isActionable(p));
  const hasAcceptable = actionable.some(isAcceptable);
  const hasUndecided = actionable.some(isUndecided);
  const hasConflict = actionable.some((p) => p.decision === "conflict");
  const blocked = (p: FieldProposal) =>
    p.field === "name" && view.tool.published && !view.canPublish ? tp("publishNeeded") : null;

  function errorText(error: RefreshActionError): string {
    return te(error);
  }

  function warningText(warning: RefreshWarning): string {
    return tw(warning);
  }

  function decide(decision: "accept" | "reject" | "accept_all_verified" | "reject_all", ids?: string[]) {
    setMessage(null);
    startTransition(async () => {
      const result = await actions.decide({ refreshId: view.id, rowRevision: view.rowRevision, decision, ids });
      if (result.ok) {
        setMessage(
          result.warning
            ? { kind: "warning", text: warningText(result.warning) }
            : result.applied > 0
              ? { kind: "ok", text: t("applied", { count: result.applied }) }
              : null
        );
      } else {
        setMessage({ kind: "error", text: result.error === "conflict" ? t("conflictNote") : errorText(result.error) });
      }
      router.refresh();
    });
  }

  function again() {
    setMessage(null);
    startTransition(async () => {
      const result = await actions.again({ refreshId: view.id, note: note.trim() || null, includeDescription: descriptions });
      if (result.ok) {
        setMessage({ kind: "ok", text: result.queued > 0 ? t("queuedAgain") : t("skippedAgain") });
        setAgainOpen(false);
      } else {
        setMessage({ kind: "error", text: errorText(result.error) });
      }
      router.refresh();
    });
  }

  return (
    <div className="admin-refresh-page">
      <ul className="admin-refresh-notes">
        {view.tool.archived ? <li>{t("archivedNote")}</li> : null}
        {running ? <li role="status">{t("queuedNote")}</li> : null}
        {view.note ? <li>{t("requestedNote", { note: view.note })}</li> : null}
        {view.categorySuggestion ? <li>{t("categorySuggestion", { category: view.categorySuggestion })}</li> : null}
        {view.duplicateOf ? (
          <li>
            <Link href={`/tools/${view.duplicateOf.slug}`}>{t("duplicateOf", { name: view.duplicateOf.name })}</Link>
          </li>
        ) : null}
        {view.status === "failed" && view.researchError ? (
          <li className="admin-intake-diagnosis" role="alert">
            <span className="admin-intake-diagnosis-label">{t("failedLabel")}: </span>
            <span className="admin-intake-diagnosis-text">{view.researchError}</span>
          </li>
        ) : null}
        {hasConflict ? <li role="alert">{t("conflictNote")}</li> : null}
      </ul>

      <div className="admin-refresh-toolbar">
        {view.status === "proposed" && hasAcceptable ? (
          <button type="button" className="admin-button is-primary" disabled={pending} onClick={() => decide("accept_all_verified")}>
            {t("acceptAll")}
          </button>
        ) : null}
        {view.status === "proposed" && hasUndecided ? (
          <button type="button" className="admin-button" disabled={pending} onClick={() => decide("reject_all")}>
            {t("rejectAll")}
          </button>
        ) : null}
        {!running ? (
          <button type="button" className="admin-button" disabled={pending} aria-expanded={againOpen} onClick={() => setAgainOpen((open) => !open)}>
            {t("again")}
          </button>
        ) : null}
        <Link className="admin-button" href={`/tools/${view.tool.slug}`}>
          {t("openEditor")}
        </Link>
        <p className={`admin-row-status${message && message.kind !== "ok" ? ` is-${message.kind}` : ""}`} role="status">
          {pending ? t("saving") : (message?.text ?? "")}
        </p>
      </div>

      {againOpen ? (
        <div className="admin-refresh-dialog">
          <label className="admin-field">
            <span>{t("againNote")}</span>
            <textarea
              value={note}
              maxLength={REVIEWER_NOTE_MAX_CHARS}
              placeholder={t("againNotePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
            />
          </label>
          <label className="admin-field is-check">
            <input type="checkbox" checked={descriptions} onChange={(event) => setDescriptions(event.target.checked)} />
            <span>{t("againDescriptions")}</span>
          </label>
          <div className="admin-editor-actions">
            <button type="button" className="admin-button is-primary" disabled={pending} onClick={again}>
              {t("againSend")}
            </button>
            <button type="button" className="admin-button" onClick={() => setAgainOpen(false)}>
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {view.status !== "queued" && view.status !== "researching" && view.status !== "failed" && actionable.length === 0 ? (
        <p className="admin-intake-done td-panel">{t("matches")}</p>
      ) : null}

      {actionable.length > 0 ? (
        <section className="admin-proposals" aria-label={t("proposalsLabel")}>
          {actionable.map((proposal) => (
            <ProposalCard
              key={proposal.id}
              proposal={proposal}
              busy={pending || view.status !== "proposed"}
              blockedReason={blocked(proposal)}
              onAccept={view.status === "proposed" ? () => decide("accept", [proposal.id]) : undefined}
              onReject={view.status === "proposed" ? () => decide("reject", [proposal.id]) : undefined}
            />
          ))}
        </section>
      ) : null}

      {notFound.length > 0 ? (
        <details className="admin-proposals">
          <summary>
            {t("notFoundLabel")} ({notFound.length})
          </summary>
          <p className="admin-intake-hint">{t("notFoundHint")}</p>
          <ul>
            {notFound.map((p) => (
              <li key={p.id}>{tp(`field.${p.field}`)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
