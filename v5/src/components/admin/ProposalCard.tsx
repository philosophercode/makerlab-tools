"use client";

import { useTranslations } from "next-intl";
import { hasVerifiedEvidence, isAcceptable, isActionable, type FieldProposal } from "../../lib/refresh/types";
import "../../styles/admin-refresh.css";

/**
 * One proposed change (refresh research spec §5.2, §6, §12.2): the field, the
 * record's value now → the proposed value, the kind and safety chips, and the
 * quotes with their links — each marked when code could not find it on the
 * page. **Accept** / **Reject** when there is something to decide.
 *
 * Shared by the Refresh review page and the assistant's `data-proposal` card,
 * so a proposal reads the same wherever it arrives. Values are rendered as
 * **text** — never HTML, never Markdown (§8: a page research read wrote them).
 * On a phone the two values stack (CSS).
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

export function ProposalCard({ proposal, onAccept, onReject, busy = false, blockedReason = null }: ProposalCardProps) {
  const t = useTranslations("admin.proposal");
  const verified = hasVerifiedEvidence(proposal);
  const decided = proposal.decision === "accepted" || proposal.decision === "rejected";
  const canAccept = isAcceptable(proposal) && !blockedReason;
  const actionable = isActionable(proposal) && !decided;

  return (
    <article
      className={`admin-proposal is-${proposal.kind}${proposal.safety ? " is-safety" : ""}${!verified ? " is-unverified" : ""}${
        decided ? ` is-${proposal.decision}` : ""
      }`}
      aria-label={t(`field.${proposal.field}`)}
    >
      <header className="admin-proposal-head">
        <h4>{t(`field.${proposal.field}`)}</h4>
        <ul className="admin-proposal-chips">
          <li className={`admin-proposal-chip is-${proposal.kind}`}>{t(`kind.${proposal.kind}`)}</li>
          {proposal.safety ? <li className="admin-proposal-chip is-safety">{t("safety")}</li> : null}
          {proposal.decision === "conflict" ? <li className="admin-proposal-chip is-conflict">{t("conflict")}</li> : null}
          {decided ? (
            <li className={`admin-proposal-chip is-${proposal.decision}`}>{t(proposal.decision === "accepted" ? "accepted" : "rejected")}</li>
          ) : null}
        </ul>
      </header>

      {proposal.kind === "unverified" ? null : (
        <div className="admin-proposal-values">
          <div className="admin-proposal-value">
            <span className="admin-proposal-label">{t("current")}</span>
            <ValueText field={proposal.field} value={proposal.current} />
          </div>
          <div className="admin-proposal-value is-proposed">
            <span className="admin-proposal-label">{t("proposed")}</span>
            <ValueText field={proposal.field} value={proposal.proposed} />
            {proposal.added && proposal.added.length > 0 ? (
              <p className="admin-proposal-added">
                {proposal.field === "use_restrictions"
                  ? t("addedRule", { lines: proposal.added.join(" / ") })
                  : t("added", { labels: proposal.added.join(", ") })}
              </p>
            ) : null}
          </div>
        </div>
      )}

      {proposal.reason ? <p className="admin-proposal-reason">{t("reason", { reason: proposal.reason })}</p> : null}

      {proposal.citations.length > 0 ? (
        <div className="admin-proposal-quotes">
          <span className="admin-proposal-label">{t("quotes")}</span>
          {proposal.citations.map((citation, n) => (
            <blockquote key={n} className={`admin-proposal-quote${citation.verified ? "" : " is-not-found"}`}>
              <p>{citation.quote}</p>
              <footer>
                <a href={citation.url} target="_blank" rel="noopener noreferrer nofollow">
                  {hostOf(citation.url)}
                </a>
                {citation.verified ? null : <span className="admin-proposal-warning">{t("quoteNotFound")}</span>}
              </footer>
            </blockquote>
          ))}
        </div>
      ) : isActionable(proposal) && !verified ? (
        <p className="admin-proposal-warning">{t("noQuote")}</p>
      ) : null}

      {actionable && !verified ? <p className="admin-intake-hint">{t("unverifiedHint")}</p> : null}
      {actionable && blockedReason ? <p className="admin-intake-hint">{blockedReason}</p> : null}

      {actionable && (onAccept || onReject) ? (
        <div className="admin-proposal-actions">
          {onAccept ? (
            <button type="button" className="admin-button is-primary" onClick={onAccept} disabled={busy || !canAccept}>
              {t("accept")}
            </button>
          ) : null}
          {onReject ? (
            <button type="button" className="admin-button" onClick={onReject} disabled={busy}>
              {t("reject")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** A proposal's value as plain text: lists joined, booleans in words, a link as its title and host. */
function ValueText({ field, value }: { field: FieldProposal["field"]; value: unknown }) {
  const t = useTranslations("admin.proposal");
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <p className="admin-proposal-text is-empty">{t("empty")}</p>;
  }
  if (typeof value === "boolean") return <p className="admin-proposal-text">{value ? t("yes") : t("no")}</p>;
  if (Array.isArray(value)) return <p className="admin-proposal-text">{value.map(String).join(", ")}</p>;
  if (typeof value === "object") {
    const record = value as { title?: unknown; url?: unknown; pageUrl?: unknown; width?: unknown; height?: unknown };
    if (field === "cover_photo" && typeof record.url === "string") {
      const page = typeof record.pageUrl === "string" ? record.pageUrl : record.url;
      return (
        <p className="admin-proposal-text">
          <a href={record.url} target="_blank" rel="noopener noreferrer nofollow">
            {`${String(record.width ?? "?")} × ${String(record.height ?? "?")}`}
          </a>{" "}
          <span className="admin-muted">{t("imageFrom", { host: hostOf(page) })}</span>
        </p>
      );
    }
    if (typeof record.url === "string") {
      return (
        <p className="admin-proposal-text">
          <a href={record.url} target="_blank" rel="noopener noreferrer nofollow">
            {typeof record.title === "string" ? record.title : record.url}
          </a>{" "}
          <span className="admin-muted">{hostOf(record.url)}</span>
        </p>
      );
    }
  }
  return <p className="admin-proposal-text">{String(value)}</p>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
