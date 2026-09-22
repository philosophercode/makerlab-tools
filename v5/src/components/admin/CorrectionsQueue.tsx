import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FeedbackQueueEntry } from "../../lib/data/feedback";
import type { SetCorrectionStatusAction } from "../../app/admin/corrections/action-result";
import { CorrectionControls } from "./CorrectionControls";

/**
 * The corrections queue on `/admin/corrections` (spec §5.6).
 *
 * A server component with no `async`, everything in props — the shape
 * `UsersTable` set, and what makes it mountable in a component test.
 *
 * **Every card is one click from the field it corrects.** The tool's own page
 * is where that field is shown, and where `EditToolControl` offers the editor
 * to anybody holding `tools.edit` (§5.3(b)) — so the link goes there rather
 * than to `/admin/inventory`, which would land the reviewer in a table they
 * then have to search. A correction whose tool never resolved says so instead
 * of linking somewhere plausible.
 *
 * **Waiting work is the page; handled work is behind a disclosure.** Dismissing
 * a correction is a judgement somebody may want to revisit, and "has this been
 * reported before" is the question a second report raises — so nothing is
 * hidden, it is only folded away.
 */

export interface CorrectionsQueueProps {
  corrections: FeedbackQueueEntry[];
  action: SetCorrectionStatusAction;
}

/** The status that means nobody has looked at it yet. */
const WAITING = "new";

export function CorrectionsQueue({ corrections, action }: CorrectionsQueueProps) {
  const t = useTranslations("admin.corrections");

  if (corrections.length === 0) {
    return <p className="admin-empty td-empty">{t("empty")}</p>;
  }

  const waiting = corrections.filter((correction) => correction.status === WAITING);
  const handled = corrections.filter((correction) => correction.status !== WAITING);

  return (
    <div className="admin-queue">
      {waiting.length === 0 ? (
        <p className="admin-empty td-empty">{t("emptyWaiting")}</p>
      ) : (
        <ul className="admin-queue-list" aria-label={t("queueLabel")}>
          {waiting.map((correction) => (
            <CorrectionCard key={correction.id} correction={correction} action={action} />
          ))}
        </ul>
      )}

      {handled.length > 0 ? (
        <details className="admin-queue-settled">
          <summary>{t("handledToggle", { count: handled.length })}</summary>
          <ul className="admin-queue-list">
            {handled.map((correction) => (
              <CorrectionCard key={correction.id} correction={correction} action={action} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function CorrectionCard({
  correction,
  action,
}: {
  correction: FeedbackQueueEntry;
  action: SetCorrectionStatusAction;
}) {
  const t = useTranslations("admin.corrections");

  return (
    <li className="admin-queue-card">
      <header className="admin-queue-card-head">
        <h3>
          {correction.toolSlug ? (
            <Link href={`/tools/${correction.toolSlug}`}>{correction.toolName}</Link>
          ) : (
            t("noTool")
          )}
        </h3>
        {correction.fieldFlagged ? (
          <span className="admin-tag">{t(`fields.${correction.fieldFlagged}`)}</span>
        ) : (
          <span className="admin-tag">{t("noField")}</span>
        )}
      </header>

      <p className="admin-queue-body">{correction.issueDescription}</p>

      {correction.suggestedFix ? (
        <p className="admin-queue-body">
          <strong>{t("suggestedFix")}</strong> {correction.suggestedFix}
        </p>
      ) : null}

      <p className="admin-queue-meta">
        {correction.reporterName ? (
          <span>{t("reportedBy", { name: correction.reporterName })}</span>
        ) : (
          <span>{t("reportedAnonymously")}</span>
        )}
        {/* The one page that may show it (§8), for the one thing it is for:
            asking the question the correction leaves open. */}
        {correction.reporterEmail ? (
          <a href={`mailto:${correction.reporterEmail}`}>{correction.reporterEmail}</a>
        ) : null}
        <span className="admin-date">
          {t("reportedOn", { date: correction.createdAt.toISOString().slice(0, 10) })}
        </span>
      </p>

      <CorrectionControls
        feedbackId={correction.id}
        status={correction.status}
        toolName={correction.toolName || t("noTool")}
        action={action}
      />
    </li>
  );
}
