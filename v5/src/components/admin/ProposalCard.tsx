"use client";

import { useTranslations } from "next-intl";
import { hasVerifiedEvidence, isAcceptable, isActionable, type FieldProposal } from "../../lib/refresh/types";
import { Button } from "@/components/ui/button";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { ReviewCard, ReviewNote, ReviewSources, ReviewValues } from "../system/review/ReviewCard";

/**
 * One proposed change (refresh research spec §5.2, §6, §12.2): the field, the
 * record's value now → the proposed value, the kind and safety marks, and the
 * quotes with their links — each marked when code could not find it on the
 * page. **Accept** / **Reject** when there is something to decide.
 *
 * Shared by the Refresh review page and the assistant's `data-proposal` card,
 * so a proposal reads the same wherever it arrives. Since the UI system spike
 * it is a composition of the shared `ReviewCard` parts (UI system spec §6.6),
 * the primitive intake and import review are to move onto as well. Values are
 * rendered as **text** — never HTML, never Markdown (§8: a page research read
 * wrote them).
 *
 * Presentational: the parent owns the action and the busy state.
 */

export interface ProposalCardProps {
  proposal: FieldProposal;
  onAccept?: () => void;
  onReject?: () => void;
  busy?: boolean;
  /** Accept is not offered for this card, with why (e.g. renaming a published tool without publish permission). */
  blockedReason?: string | null;
}

const KIND_TONE: Record<FieldProposal["kind"], StatusTone> = { differs: "active", new: "ok", unverified: "idle" };

export function ProposalCard({ proposal, onAccept, onReject, busy = false, blockedReason = null }: ProposalCardProps) {
  const t = useTranslations("admin.proposal");
  const verified = hasVerifiedEvidence(proposal);
  const decided = proposal.decision === "accepted" || proposal.decision === "rejected";
  const canAccept = isAcceptable(proposal) && !blockedReason;
  const actionable = isActionable(proposal) && !decided;
  const label = t(`field.${proposal.field}`);

  return (
    <ReviewCard
      label={label}
      tone={decided ? "settled" : proposal.safety ? "safety" : "default"}
      marks={
        <>
          <StatusGlyph tone={KIND_TONE[proposal.kind]} label={t(`kind.${proposal.kind}`)} />
          {proposal.safety ? <StatusGlyph tone="bad" label={t("safety")} /> : null}
          {proposal.decision === "conflict" ? <StatusGlyph tone="warn" label={t("conflict")} /> : null}
          {decided ? (
            <StatusGlyph
              tone={proposal.decision === "accepted" ? "ok" : "muted"}
              label={t(proposal.decision === "accepted" ? "accepted" : "rejected")}
            />
          ) : null}
        </>
      }
      actions={
        actionable && (onAccept || onReject) ? (
          <>
            {onAccept ? (
              <Button variant="default" size="xs" onClick={onAccept} disabled={busy || !canAccept}>
                {t("accept")}
              </Button>
            ) : null}
            {onReject ? (
              <Button variant="quiet" size="xs" onClick={onReject} disabled={busy}>
                {t("reject")}
              </Button>
            ) : null}
          </>
        ) : null
      }
    >
      {proposal.kind === "unverified" ? null : (
        <ReviewValues
          before={{ label: t("current"), content: <ValueText field={proposal.field} value={proposal.current} /> }}
          after={{
            label: t("proposed"),
            content: <ValueText field={proposal.field} value={proposal.proposed} />,
            note:
              proposal.added && proposal.added.length > 0
                ? proposal.field === "use_restrictions"
                  ? t("addedRule", { lines: proposal.added.join(" / ") })
                  : t("added", { labels: proposal.added.join(", ") })
                : undefined,
          }}
        />
      )}

      {proposal.reason ? <ReviewNote>{t("reason", { reason: proposal.reason })}</ReviewNote> : null}

      {proposal.citations.length > 0 ? (
        <ReviewSources
          label={t("quotes")}
          notFoundLabel={t("quoteNotFound")}
          items={proposal.citations.map((citation) => ({ ...citation, host: hostOf(citation.url) }))}
        />
      ) : isActionable(proposal) && !verified ? (
        <ReviewNote tone="warn">{t("noQuote")}</ReviewNote>
      ) : null}

      {actionable && !verified ? <ReviewNote>{t("unverifiedHint")}</ReviewNote> : null}
      {actionable && blockedReason ? <ReviewNote tone="warn">{blockedReason}</ReviewNote> : null}
    </ReviewCard>
  );
}

/** A proposal's value as plain text: lists joined, booleans in words, a link as its title and host. */
function ValueText({ field, value }: { field: FieldProposal["field"]; value: unknown }) {
  const t = useTranslations("admin.proposal");
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <p className="m-0 italic opacity-70">{t("empty")}</p>;
  }
  if (typeof value === "boolean") return <p className="m-0">{value ? t("yes") : t("no")}</p>;
  if (Array.isArray(value)) return <p className="m-0">{value.map(String).join(", ")}</p>;
  if (typeof value === "object") {
    const record = value as { title?: unknown; url?: unknown; pageUrl?: unknown; width?: unknown; height?: unknown };
    if (field === "cover_photo" && typeof record.url === "string") {
      const page = typeof record.pageUrl === "string" ? record.pageUrl : record.url;
      return (
        <p className="m-0">
          <a href={record.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {`${String(record.width ?? "?")} × ${String(record.height ?? "?")}`}
          </a>{" "}
          <span className="text-muted-foreground">{t("imageFrom", { host: hostOf(page) })}</span>
        </p>
      );
    }
    if (typeof record.url === "string") {
      return (
        <p className="m-0">
          <a href={record.url} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {typeof record.title === "string" ? record.title : record.url}
          </a>{" "}
          <span className="text-muted-foreground">{hostOf(record.url)}</span>
        </p>
      );
    }
  }
  return <p className="m-0 whitespace-pre-line">{String(value)}</p>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
