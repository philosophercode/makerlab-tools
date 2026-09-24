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
    <details className="td-doc-contents">
      <summary>{t("manualContents")}</summary>
      <ol>
        {entries.map((entry, index) => (
          <li key={`${entry.page}-${index}`} className={entry.level > 1 ? "is-nested" : undefined}>
            <a href={`${base}#page=${entry.page}`} target="_blank" rel="noreferrer noopener">
              <span>{entry.title}</span>
              <span className="td-doc-contents-page">{t("manualContentsPage", { page: entry.page })}</span>
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}
