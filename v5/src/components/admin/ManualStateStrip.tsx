import { useTranslations } from "next-intl";
import type { ManualStateCounts } from "../../lib/data/manual-chunks";
import { Glyph, type StatusTone } from "../system/StatusGlyph";

/**
 * The manual library by state, as one compact strip (public polish): a label
 * on the left and its number right-aligned and tabular on the right, the five
 * states then the pages and passages stored — four to a row on a desktop, one
 * per line on a phone. It replaces a `td-panel` definition list whose labels
 * and zeros stacked on separate lines. Presentational; the page reads the
 * counts, and the table below counts the same buckets.
 */
const STATES: Array<{ key: keyof ManualStateCounts; tone?: StatusTone }> = [
  { key: "searchable", tone: "ok" },
  { key: "textOnly", tone: "idle" },
  { key: "noText", tone: "warn" },
  { key: "failed", tone: "bad" },
  { key: "processing", tone: "idle" },
  { key: "pages" },
  { key: "passages" },
];

export function ManualStateStrip({ counts }: { counts: ManualStateCounts }) {
  const t = useTranslations("admin.research");
  return (
    <dl
      aria-label={t("stripLabel")}
      data-slot="manual-state-strip"
      className="ui grid grid-cols-1 border-t border-rule text-table sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-8"
    >
      {STATES.map(({ key, tone }) => (
        <div key={key} data-manual-count={key} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
          <dt className="flex items-baseline gap-1.5 text-muted-foreground">
            {tone ? <Glyph tone={tone} /> : null}
            {t(key)}
          </dt>
          <dd className={`font-mono tabular-nums ${counts[key] === 0 ? "text-muted-foreground" : ""}`}>{counts[key]}</dd>
        </div>
      ))}
    </dl>
  );
}
