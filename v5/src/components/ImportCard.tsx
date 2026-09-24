"use client";

import "../styles/admin-import.css";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ImportCardPayload } from "../lib/import/view";

/**
 * The chat's hand-off card (bulk intake spec §3.5): what `start_import` made
 * of a long list — "42 items found (3 possible duplicates)" — and a **Review
 * import** link to the import page, where the rows are reviewed and researched.
 * A table whose columns still need matching says so; a document says it is
 * being read. Nothing here writes.
 */
export function ImportCard({ payload }: { payload: ImportCardPayload }) {
  const t = useTranslations("chat.importCard");
  const { import: found, href } = payload;

  let line: string;
  if (found.status === "ready") {
    line = t("found", { count: found.itemCount });
    if (found.duplicateCount > 0) line = `${line} ${t("duplicates", { count: found.duplicateCount })}`;
  } else if (found.status === "mapping") {
    line = t("mapping");
  } else if (found.status === "parsing") {
    line = t("parsing");
  } else {
    line = t("failed");
  }

  return (
    <div className="import-card" role="group" aria-label={t("label")}>
      <p>
        <strong>{found.sourceName ?? t("pasted")}</strong>
      </p>
      <p>{line}</p>
      <p>
        <Link className="admin-button is-primary" href={href}>
          {t("review")}
        </Link>
      </p>
    </div>
  );
}
