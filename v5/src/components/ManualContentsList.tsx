import { useTranslations } from "next-intl";
import type { ManualOutlineEntry } from "../lib/db/schema/manuals";

/**
 * A manual's chapters under its link on the tool page (manual text spec §6):
 * a collapsed **Contents** disclosure, each entry opening the stored PDF at its
 * page (`#page=N`). Top two levels only, and at most {@link MAX_ENTRIES} — a
 * table of contents, not the index. A native `<details>`, so it needs no
 * client JavaScript and the page stays a server component.
 */

export const MAX_ENTRIES = 60;

export function ManualContentsList({ href, outline }: { href: string; outline: readonly ManualOutlineEntry[] }) {
  const t = useTranslations("detail");
  const entries = outline.filter((entry) => entry.level <= 2).slice(0, MAX_ENTRIES);
  if (entries.length === 0) return null;
  const base = href.split("#")[0];
  return (
    <details data-slot="manual-contents" className="mt-1.5 ms-[calc(6.5rem+0.75rem)] text-xs">
      <summary className="cursor-pointer font-mono text-label tracking-[0.08em] text-muted-foreground uppercase hover:text-foreground">
        {t("manualContents")}
      </summary>
      <ol className="m-0 mt-1 flex list-none flex-col p-0">
        {entries.map((entry, index) => (
          <li key={`${entry.page}-${index}`} className={entry.level > 1 ? "ps-4" : undefined}>
            <a
              href={`${base}#page=${entry.page}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-baseline justify-between gap-3 py-0.5 hover:text-primary-ink"
            >
              <span className="min-w-0">{entry.title}</span>
              <span className="font-mono text-muted-foreground tabular-nums">{t("manualContentsPage", { page: entry.page })}</span>
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
