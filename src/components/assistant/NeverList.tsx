import { useTranslations } from "next-intl";
import type { NeverItem } from "../../lib/assistant/capabilities-page";
import { Glyph } from "../system/StatusGlyph";

/**
 * "Never, on any surface, whatever your role" on `/assistant`: the deny list
 * in `lib/actions/define.ts` (the super-admin rule, the forbidden actions and
 * the forbidden categories), one hairline row each with its reason. A
 * category also shows the words that make any tool name refused — what
 * actually enforces it. Presentational; no state.
 */
export function NeverList({ items }: { items: NeverItem[] }) {
  const t = useTranslations("assistantPage.never");
  const tPage = useTranslations("assistantPage");
  return (
    <ul className="m-0 list-none border-t border-rule p-0" data-slot="never-list">
      {items.map((item) => (
        <li key={item.key} data-never={item.key} className="grid gap-x-4 gap-y-0.5 border-b border-rule py-2 text-table sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <span className="flex items-baseline gap-2 font-medium">
            <Glyph tone="bad" />
            {t(item.labelKey)}
          </span>
          <span className="flex flex-col gap-0.5 ps-4 text-muted-foreground sm:ps-0">
            <span>{t(`${item.labelKey}Why`)}</span>
            {item.words ? (
              <span className="text-micro">
                {tPage("refusedWords")} <code className="font-mono break-words">{item.words.join(", ")}</code>
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
