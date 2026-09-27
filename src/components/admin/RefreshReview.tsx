"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { RefreshActionError, RefreshReviewActions, RefreshWarning } from "../../app/admin/refresh/action-result";
import type { RefreshStatus } from "../../lib/db/schema/vocabulary";
import { INTAKE_POLL_INTERVAL_MS, REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import { isAcceptable, isActionable, isUndecided, type FieldProposal } from "../../lib/refresh/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Field } from "../system/Field";
import { Glyph } from "../system/StatusGlyph";
import { ReviewDiagnosis, ReviewNote } from "../system/review/ReviewCard";
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
 * Since UI system phase 3 the page is the shared review layout: a toolbar
 * (Accept all verified is the one filled button), notes as glyph lines, the
 * cards as `ReviewCard`s (via `ProposalCard`) and the outcome line beside the
 * toolbar.
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
  const noteId = useId();
  const descriptionsId = useId();

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

  const notes =
    view.tool.archived ||
    running ||
    view.note ||
    view.categorySuggestion ||
    view.duplicateOf ||
    hasConflict;

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
        <ReviewNote
          role="status"
          tone={message?.kind === "error" ? "bad" : message?.kind === "warning" ? "warn" : "muted"}
          className="ms-auto"
        >
          {pending ? t("saving") : (message?.text ?? "")}
        </ReviewNote>
      </div>

      {notes ? (
        <ul className="flex flex-col gap-1 text-table">
          {view.tool.archived ? (
            <li>
              <Glyph tone="muted" className="me-1.5" />
              {t("archivedNote")}
            </li>
          ) : null}
          {running ? (
            <li role="status">
              <Glyph tone="idle" className="me-1.5" />
              {t("queuedNote")}
            </li>
          ) : null}
          {view.note ? <li className="text-muted-foreground">{t("requestedNote", { note: view.note })}</li> : null}
          {view.categorySuggestion ? (
            <li className="text-muted-foreground">
              <Glyph tone="idle" className="me-1.5" />
              {t("categorySuggestion", { category: view.categorySuggestion })}
            </li>
          ) : null}
          {view.duplicateOf ? (
            <li>
              <Glyph tone="warn" className="me-1.5" />
              <Link className="underline underline-offset-2" href={`/tools/${view.duplicateOf.slug}`}>
                {t("duplicateOf", { name: view.duplicateOf.name })}
              </Link>
            </li>
          ) : null}
          {hasConflict ? (
            <li role="alert" className="text-warn">
              <Glyph tone="warn" className="me-1.5" />
              {t("conflictNote")}
            </li>
          ) : null}
        </ul>
      ) : null}

      {view.status === "failed" && view.researchError ? (
        <div role="alert">
          <ReviewDiagnosis label={t("failedLabel")}>{view.researchError}</ReviewDiagnosis>
        </div>
      ) : null}

      {againOpen ? (
        // An inline disclosure: a form that belongs to the page (DESIGN.md §8.7).
        <div className="flex flex-col gap-3 border-s-2 border-s-primary-ink bg-card p-4">
          <Field id={noteId} label={t("againNote")}>
            <Textarea
              id={noteId}
              value={note}
              maxLength={REVIEWER_NOTE_MAX_CHARS}
              placeholder={t("againNotePlaceholder")}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
            />
          </Field>
          <div className="flex items-center gap-2 text-table">
            <Checkbox id={descriptionsId} checked={descriptions} onCheckedChange={(value) => setDescriptions(value === true)} />
            <label htmlFor={descriptionsId}>{t("againDescriptions")}</label>
          </div>
          <div className="flex flex-wrap gap-2">
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
        <p className="flex items-baseline gap-1.5 text-table">
          <Glyph tone="ok" />
          {t("matches")}
        </p>
      ) : null}

      {actionable.length > 0 ? (
        <section aria-label={t("proposalsLabel")} className="border-t border-rule">
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
        <details className="group text-table">
          <summary className="cursor-pointer font-mono text-label text-muted-foreground uppercase">
            {t("notFoundLabel")} ({notFound.length})
          </summary>
          <div className="mt-2 flex flex-col gap-1 ps-4">
            <ReviewNote>{t("notFoundHint")}</ReviewNote>
            <ul className="flex flex-col gap-0.5">
              {notFound.map((p) => (
                <li key={p.id}>
                  <Glyph tone="idle" className="me-1.5" />
                  {tp(`field.${p.field}`)}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </div>
  );
}
