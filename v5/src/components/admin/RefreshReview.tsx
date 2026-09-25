"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { RefreshActionError, RefreshReviewActions, RefreshWarning } from "../../app/admin/refresh/action-result";
import type { RefreshStatus } from "../../lib/db/schema/vocabulary";
import { INTAKE_POLL_INTERVAL_MS, REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import { isAcceptable, isActionable, isUndecided, type FieldProposal } from "../../lib/refresh/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ReviewNote } from "../system/review/ReviewCard";
import { Glyph } from "../system/StatusGlyph";
import { ProposalCard } from "./ProposalCard";

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
 *
 * UI system spike: the chrome is the shared review layout — a one-line
 * summary of what is waiting, a toolbar with one filled action, the notes as
 * a quiet list, and `ReviewCard`s (through `ProposalCard`) instead of boxed
 * panels.
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
    <div className="ui flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
        {view.status === "proposed" && hasAcceptable ? (
          <Button variant="default" size="sm" disabled={pending} onClick={() => decide("accept_all_verified")}>
            {t("acceptAll")}
          </Button>
        ) : null}
        {view.status === "proposed" && hasUndecided ? (
          <Button size="sm" disabled={pending} onClick={() => decide("reject_all")}>
            {t("rejectAll")}
          </Button>
        ) : null}
        {!running ? (
          <Button size="sm" disabled={pending} aria-expanded={againOpen} onClick={() => setAgainOpen((open) => !open)}>
            {t("again")}
          </Button>
        ) : null}
        <Button asChild variant="ghost" size="sm">
          <Link href={`/tools/${view.tool.slug}`}>{t("openEditor")}</Link>
        </Button>
        <p
          role="status"
          className={cn(
            "m-0 ml-auto text-[12px]",
            message?.kind === "error" && "text-bad",
            message?.kind === "warning" && "text-warn",
            (!message || message.kind === "ok") && "text-muted-foreground"
          )}
        >
          {pending ? t("saving") : (message?.text ?? "")}
        </p>
      </div>

      {view.tool.archived ||
      running ||
      view.note ||
      view.categorySuggestion ||
      view.duplicateOf ||
      (view.status === "failed" && view.researchError) ||
      hasConflict ? (
        <ul className="flex flex-col gap-1 text-[13px]">
          {view.tool.archived ? <li>{t("archivedNote")}</li> : null}
          {running ? <li role="status">{t("queuedNote")}</li> : null}
          {view.note ? <li>{t("requestedNote", { note: view.note })}</li> : null}
          {view.categorySuggestion ? (
            <li className="text-muted-foreground">
              <Glyph tone="idle" />
              {t("categorySuggestion", { category: view.categorySuggestion })}
            </li>
          ) : null}
          {view.duplicateOf ? (
            <li>
              <Glyph tone="warn" />
              <Link className="underline underline-offset-2" href={`/tools/${view.duplicateOf.slug}`}>
                {t("duplicateOf", { name: view.duplicateOf.name })}
              </Link>
            </li>
          ) : null}
          {view.status === "failed" && view.researchError ? (
            <li role="alert" className="text-bad">
              <Glyph tone="bad" />
              <span className="font-mono text-[11px] uppercase">{t("failedLabel")}: </span>
              <span>{view.researchError}</span>
            </li>
          ) : null}
          {hasConflict ? (
            <li role="alert" className="text-warn">
              <Glyph tone="warn" />
              {t("conflictNote")}
            </li>
          ) : null}
        </ul>
      ) : null}

      {againOpen ? (
        <div className="flex flex-col gap-3 border border-border bg-card p-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{t("againNote")}</span>
            <textarea
              value={note}
              maxLength={REVIEWER_NOTE_MAX_CHARS}
              placeholder={t("againNotePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              className="border border-border bg-background p-2 text-[14px] text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid"
            />
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={descriptions} onChange={(event) => setDescriptions(event.target.checked)} />
            <span>{t("againDescriptions")}</span>
          </label>
          <div className="flex gap-2">
            <Button variant="default" size="sm" disabled={pending} onClick={again}>
              {t("againSend")}
            </Button>
            <Button size="sm" onClick={() => setAgainOpen(false)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : null}

      {view.status !== "queued" && view.status !== "researching" && view.status !== "failed" && actionable.length === 0 ? (
        <ReviewNote>{t("matches")}</ReviewNote>
      ) : null}

      {actionable.length > 0 ? (
        <section aria-label={t("proposalsLabel")} className="border-t border-border">
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
        <details className="text-[13px]">
          <summary className="cursor-pointer font-mono text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
            {t("notFoundLabel")} ({notFound.length})
          </summary>
          <p className="mt-2 text-muted-foreground">{t("notFoundHint")}</p>
          <ul className="mt-1 flex flex-wrap gap-x-4">
            {notFound.map((p) => (
              <li key={p.id}>
                <Glyph tone="idle" />
                {tp(`field.${p.field}`)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
