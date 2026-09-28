"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ImportCardPayload } from "../lib/import/view";
import { Button } from "@/components/ui/button";

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
    <div role="group" aria-label={t("label")} className="ui flex flex-col items-start gap-2 border border-border bg-card p-3 text-sm">
      <p className="font-medium">{found.sourceName ?? t("pasted")}</p>
      <p className="text-muted-foreground">{line}</p>
      <Button asChild variant="default" size="sm">
        <Link href={href}>{t("review")}</Link>
      </Button>
    </div>
  );
}
