"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { FeedbackQueueEntry } from "../../lib/data/feedback";
import { FEEDBACK_STATUS, FLAG_FIELDS } from "../../lib/db/schema/vocabulary";
import type { SetCorrectionStatusAction } from "../../app/admin/corrections/action-result";
import { Badge } from "@/components/ui/badge";
import { QueueList } from "../system/queue/QueueList";
import { ReviewCard } from "../system/review/ReviewCard";
import { CorrectionControls } from "./CorrectionControls";
import { personLabel } from "./person-label";

/**
 * The corrections queue on `/admin/corrections` (spec §5.6), on the shared
 * `QueueList` (UI system phase 4): search and Status / Field facets, waiting
 * corrections on the page, handled ones behind the disclosure — dismissing a
 * correction is a judgement somebody may want to revisit, and "has this been
 * reported before" is the question a second report raises.
 *
 * **Every card is one click from the field it corrects.** The tool's own page
 * shows that field and offers the editor to anybody holding `tools.edit`
 * (§5.3(b)), so the card's title links there rather than to
 * `/admin/inventory`. A correction whose tool never resolved says so instead
 * of linking somewhere plausible.
 */

export interface CorrectionsQueueProps {
  corrections: FeedbackQueueEntry[];
  action: SetCorrectionStatusAction;
}

/** The status that means nobody has looked at it yet. */
const WAITING = "new";

export function CorrectionsQueue({ corrections, action }: CorrectionsQueueProps) {
  const t = useTranslations("admin.corrections");

  return (
    <QueueList
      items={corrections}
      getId={(correction) => correction.id}
      isOpen={(correction) => correction.status === WAITING}
      searchText={(correction) =>
        [correction.toolName, correction.issueDescription, correction.suggestedFix, correction.reporterName].join(" ")
      }
      facets={[
        {
          id: "status",
          label: t("fieldStatus"),
          values: FEEDBACK_STATUS,
          valueLabel: (value) => t(`status.${value}`),
          matches: (correction, value) => correction.status === value,
        },
        {
          id: "field",
          label: t("fieldField"),
          values: FLAG_FIELDS,
          valueLabel: (value) => t(`fields.${value}`),
          matches: (correction, value) => correction.fieldFlagged === value,
        },
      ]}
      labels={{
        list: t("queueLabel"),
        filters: t("filtersLabel"),
        search: t("search"),
        searchPlaceholder: t("searchPlaceholder"),
        settled: (count) => t("handledToggle", { count }),
        empty: t("empty"),
        emptyOpen: t("emptyWaiting"),
      }}
      renderItem={(correction) => <CorrectionCard correction={correction} action={action} />}
    />
  );
}

function CorrectionCard({ correction, action }: { correction: FeedbackQueueEntry; action: SetCorrectionStatusAction }) {
  const t = useTranslations("admin.corrections");
  const tPeople = useTranslations("admin.people");
  const reporter = personLabel(tPeople, correction.reporterName, correction.reporterRemoved);
  const name = correction.toolName || t("noTool");

  return (
    <ReviewCard
      label={name}
      headingLevel={3}
      title={
        correction.toolSlug ? (
          <Link className="text-primary-ink underline-offset-2 hover:underline" href={`/tools/${correction.toolSlug}`}>
            {correction.toolName}
          </Link>
        ) : (
          t("noTool")
        )
      }
      tone={correction.status === WAITING ? "default" : "settled"}
      marks={<Badge>{correction.fieldFlagged ? t(`fields.${correction.fieldFlagged}`) : t("noField")}</Badge>}
      meta={
        <>
          <span>{reporter ? t("reportedBy", { name: reporter }) : t("reportedAnonymously")}</span>
          {/* The one page that may show it (§8), for the one thing it is for:
              asking the question the correction leaves open. */}
          {correction.reporterEmail ? (
            <a className="text-primary-ink normal-case hover:underline" href={`mailto:${correction.reporterEmail}`}>
              {correction.reporterEmail}
            </a>
          ) : null}
          <span className="tabular-nums">{t("reportedOn", { date: new Date(correction.createdAt).toISOString().slice(0, 10) })}</span>
        </>
      }
    >
      <p className="m-0 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap">{correction.issueDescription}</p>

      {correction.suggestedFix ? (
        <p className="m-0 max-w-[78ch] text-sm leading-relaxed whitespace-pre-wrap">
          <strong className="font-medium">{t("suggestedFix")}</strong> {correction.suggestedFix}
        </p>
      ) : null}

      <CorrectionControls feedbackId={correction.id} status={correction.status} toolName={name} action={action} />
    </ReviewCard>
  );
}
