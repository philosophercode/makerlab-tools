import { useTranslations } from "next-intl";
import { QUESTION_KINDS, type QuestionKind } from "../../../lib/db/schema/vocabulary";
import { Sparkline } from "../../system/Sparkline";

/**
 * Question kinds over time: one row per kind — its name, a daily sparkline
 * for the period (the admin tiles' word-sized graphic, DESIGN.md §2.6) and
 * its total. Each sparkline is one `role="img"` named by a sentence, so the
 * numbers are there for a screen reader too.
 */
export function QuestionKinds({ kinds }: { kinds: Record<QuestionKind, number[]> }) {
  const t = useTranslations("admin.insights.kinds");
  return (
    <div data-slot="question-kinds" className="ui flex flex-col gap-2">
      <ul className="m-0 flex list-none flex-col border-t border-rule p-0 text-table">
        {QUESTION_KINDS.map((kind) => {
          const values = kinds[kind] ?? [];
          const total = values.reduce((a, b) => a + b, 0);
          return (
            <li key={kind} data-question-kind={kind} className="grid grid-cols-[minmax(0,1fr)_auto_3.5rem] items-center gap-3 border-b border-rule py-1.5">
              <span className="text-muted-foreground">{t(kind)}</span>
              <Sparkline values={values} width={160} label={t("series", { kind: t(kind), total })} />
              <span className={`text-end font-mono tabular-nums ${total === 0 ? "text-muted-foreground" : ""}`}>{total}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("note")}</p>
    </div>
  );
}
