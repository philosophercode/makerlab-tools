import { useTranslations } from "next-intl";
import type { InboxDecided } from "../../lib/actions/inbox";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";

/**
 * The last week's decided MCP proposals, for reference (assistant–GUI parity
 * spec §6): what each was, from its stored summary, and how it ended. A
 * server component: nothing here can be clicked into running again — a new
 * proposal is a new request.
 */

const TONE: Record<InboxDecided["status"], StatusTone> = {
  confirmed: "ok",
  failed: "bad",
  conflict: "warn",
  cancelled: "muted",
};

export function DecidedProposals({ rows }: { rows: readonly InboxDecided[] }) {
  const t = useTranslations("actions");
  const te = useTranslations("admin.errors");
  return (
    <section className="ui flex flex-col gap-2" aria-labelledby="proposals-decided">
      <h3 id="proposals-decided" className="font-heading text-lg font-medium uppercase">
        {t("inbox.decidedHeading")}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-slot="decided-proposals">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-rule py-1.5 text-sm">
            <StatusGlyph tone={TONE[row.status]} label={t(`card.status.${row.status}`)} />
            <span className="min-w-0 break-words">
              {t(`summary.${row.preview.summary.key}` as "summary.people_set_title", row.preview.summary.values)}
            </span>
            {row.error && row.status === "failed" && te.has(row.error as "failed") ? (
              <span className="text-xs text-muted-foreground">{te(row.error as "failed")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
