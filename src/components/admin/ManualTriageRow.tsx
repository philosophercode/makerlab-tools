"use client";

import { useTranslations } from "next-intl";
import type { TriageDocState, TriageField, TriageProposal } from "../../lib/actions/manual-triage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { ReviewNote } from "../system/review/ReviewCard";
import type { TriageRowState, TriageRowStatus } from "./manual-triage-state";

/**
 * One proposed change in the Manuals view (assistant–GUI parity spec,
 * amendment 2026-10-07): what it does as a label (Add manual, Replace link,
 * Retype, Retitle, Hide, Re-archive), the document's kind, title, link and
 * visibility before and after, the link's host, and **Open PDF**, **Confirm**
 * and **Dismiss**.
 *
 * Every value is text. A link is drawn only for an `http(s)` address, opens
 * in a new tab, and carries no referrer. Presentational: the view owns the
 * request and the row's state.
 */

const FIELDS: readonly TriageField[] = ["type", "title", "url", "hidden"];

const STATUS_TONE: Record<TriageRowStatus, StatusTone> = {
  open: "active",
  chosen: "ok",
  sending: "warn",
  confirmed: "ok",
  cancelled: "muted",
  conflict: "warn",
  failed: "bad",
  expired: "muted",
  already_decided: "muted",
  not_found: "bad",
};

export interface ManualTriageRowProps {
  proposal: TriageProposal;
  state: TriageRowState;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onUndo: () => void;
}

export function ManualTriageRow({ proposal, state, busy, onConfirm, onDismiss, onUndo }: ManualTriageRowProps) {
  const t = useTranslations("actions.triage");
  const te = useTranslations("admin.errors");
  const labelId = `triage-row-${proposal.id}`;
  const label = proposal.changes.map((change) => t(`change.${change}`)).join(" · ") || t("change.edit");
  const open = state.status === "open";
  const chosen = state.status === "chosen";
  const reason = state.error && te.has(state.error as "failed") ? te(state.error as "failed") : te("failed");

  return (
    <li
      data-proposal-id={proposal.id}
      data-status={state.status}
      aria-labelledby={labelId}
      className={cn("flex flex-col gap-2 border-t border-rule py-3", !open && !chosen && state.status !== "sending" && "opacity-75")}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span id={labelId} className="font-mono text-label tracking-[0.08em] text-foreground uppercase">
          {label}
        </span>
        <StatusGlyph tone={STATUS_TONE[state.status]} label={t(`status.${state.status}`)} />
        {proposal.host ? <span className="text-xs text-muted-foreground">{proposal.host}</span> : null}
        {proposal.pages !== null ? <span className="text-xs text-muted-foreground">{t("pages", { count: proposal.pages })}</span> : null}
      </div>

      {/* `relative`: the cells' sr-only text is absolutely positioned, and would otherwise escape this scroller and widen the page on a phone. */}
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[30rem] border-collapse text-left text-table">
          <caption className="sr-only">{t("tableCaption", { label })}</caption>
          <thead>
            <tr className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
              <th scope="col" className="w-16 py-1 pe-3 font-normal">
                <span className="sr-only">{t("when")}</span>
              </th>
              {FIELDS.map((field) => (
                <th key={field} scope="col" className="py-1 pe-3 font-normal">
                  {t(`field.${field}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="align-top text-muted-foreground">
              <th scope="row" className="py-1 pe-3 font-mono text-micro font-normal tracking-[0.08em] uppercase">
                {t("before")}
              </th>
              {proposal.before ? (
                FIELDS.map((field) => (
                  <td key={field} className="max-w-[16rem] py-1 pe-3 break-words">
                    <Value doc={proposal.before!} field={field} />
                  </td>
                ))
              ) : (
                <td colSpan={FIELDS.length} className="py-1 pe-3 italic">
                  {t("newDocument")}
                </td>
              )}
            </tr>
            <tr className="align-top">
              <th scope="row" className="py-1 pe-3 font-mono text-micro font-normal tracking-[0.08em] text-muted-foreground uppercase">
                {t("after")}
              </th>
              {FIELDS.map((field) => {
                const changed = proposal.changed.includes(field);
                return (
                  <td key={field} className={cn("max-w-[16rem] py-1 pe-3 break-words", changed ? "font-medium text-foreground" : "text-muted-foreground")}>
                    <Value doc={proposal.after} field={field} />
                    {changed ? <span className="sr-only">{` (${t("changed")})`}</span> : null}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {proposal.missing ? <ReviewNote tone="warn">{t("missingHint")}</ReviewNote> : null}
      {!proposal.missing && proposal.stale.length > 0 && (open || chosen) ? <ReviewNote tone="warn">{t("staleHint")}</ReviewNote> : null}
      {chosen ? <ReviewNote>{t("chosenHint")}</ReviewNote> : null}
      {state.status === "conflict" ? (
        <ReviewNote tone="bad" role="alert">
          {t("conflictHint")}
        </ReviewNote>
      ) : null}
      {state.status === "failed" || state.status === "not_found" ? (
        <ReviewNote tone="bad" role="alert">
          {t("failedHint", { reason })}
        </ReviewNote>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {proposal.openUrl ? (
          <Button asChild variant="quiet" size="xs">
            <a href={proposal.openUrl} target="_blank" rel="noopener noreferrer nofollow" aria-describedby={labelId} data-slot="triage-open">
              {proposal.openIsPdf ? t("openPdf") : t("openLink")}
              <span className="sr-only">{` ${t("opensNewTab")}`}</span>
            </a>
          </Button>
        ) : null}
        {open ? (
          <>
            <Button type="button" variant="outline" size="xs" disabled={busy} aria-describedby={labelId} onClick={onConfirm}>
              {t("confirm")}
            </Button>
            <Button type="button" variant="quiet" size="xs" disabled={busy} aria-describedby={labelId} onClick={onDismiss}>
              {t("dismiss")}
            </Button>
          </>
        ) : null}
        {chosen ? (
          <>
            <Button type="button" variant="quiet" size="xs" disabled={busy} aria-describedby={labelId} onClick={onUndo}>
              {t("undo")}
            </Button>
            <Button type="button" variant="quiet" size="xs" disabled={busy} aria-describedby={labelId} onClick={onDismiss}>
              {t("dismiss")}
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}

/** One field's value as text: an empty one as a dash, visibility in words, a link as host and file name. */
function Value({ doc, field }: { doc: TriageDocState; field: TriageField }) {
  const t = useTranslations("actions.triage");
  if (field === "hidden") return <>{doc.hidden ? t("hiddenYes") : t("hiddenNo")}</>;
  const value = doc[field];
  if (value === null || value === "") return <span aria-label={t("emptyLabel")}>—</span>;
  if (field === "url") return <span title={value}>{shortLink(value)}</span>;
  return <>{value}</>;
}

/** `host/…/file.pdf`: enough to tell two links apart without the whole address. */
export function shortLink(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return host;
    const last = decodeURIComponent(parts[parts.length - 1]);
    return parts.length === 1 ? `${host}/${last}` : `${host}/…/${last}`;
  } catch {
    return url;
  }
}
