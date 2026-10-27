"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ProgressResult } from "../app/admin/intake/imports/action-result";
import { loadImportProgress } from "../app/admin/intake/imports/actions";
import { IMPORT_POLL_IDLE_AFTER_MS, IMPORT_POLL_IDLE_INTERVAL_MS, IMPORT_POLL_INTERVAL_MS } from "../lib/import/limits";
import { importCounts, importIsMoving, importStage, mergeItems } from "../lib/import/progress";
import type { ImportCardPayload, ImportItemView } from "../lib/import/view";
import { ImportProgress } from "./admin/ImportProgress";
import { ACTION_CONFIRMED_EVENT } from "./chat/ActionProposalCard";
import { usePoll } from "./admin/use-poll";
import { Button } from "@/components/ui/button";

/**
 * The chat's hand-off card (bulk intake spec §3.5; import progress spec
 * 2026-10-27 §3.4): what `start_import` made of a long list, followed live —
 * the same bar and stage line as the import page, at compact density, while
 * rows are identified and research runs — and a **Review import** link to the
 * import page. A table whose columns still need matching says so.
 *
 * It asks once when it appears (an old card in a reopened chat shows where
 * its import got to), then again only while something moves, and not at all
 * while the tab is hidden. Nothing here writes.
 */

export interface ImportCardProps {
  payload: ImportCardPayload;
  /** For tests: the progress read. */
  load?: (input: { importId: string; since?: string }) => Promise<ProgressResult>;
}

export function ImportCard({ payload, load = loadImportProgress }: ImportCardProps) {
  const t = useTranslations("chat.importCard");
  const { href } = payload;
  const [found, setFound] = useState(payload.import);
  const [items, setItems] = useState<ImportItemView[]>([]);
  const [heard, setHeard] = useState(false);
  const cursor = useRef<string | undefined>(undefined);
  const lastChange = useRef(0);
  const [slow, setSlow] = useState(false);

  const counts = useMemo(() => importCounts(found, items), [found, items]);
  const stage = importStage(found, counts);

  async function ask() {
    try {
      const result = await load({ importId: found.id, since: cursor.current });
      if (!result.ok) return;
      cursor.current = result.cursor;
      setFound(result.import);
      const now = Date.now();
      if (result.items.length > 0 || lastChange.current === 0) lastChange.current = now;
      if (result.items.length > 0) setItems((current) => mergeItems(current, result.items));
      setSlow(now - lastChange.current > IMPORT_POLL_IDLE_AFTER_MS);
      setHeard(true);
    } catch {
      // The card keeps what it last showed; the next tick asks again.
    }
  }

  // Once on arrival: the payload is the moment start_import answered.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  // Research confirmed on a proposal card starts work this card cannot see
  // until it asks again; once asked, the stage moves and polling resumes.
  useEffect(() => {
    const again = () => {
      lastChange.current = 0;
      void ask();
    };
    window.addEventListener(ACTION_CONFIRMED_EVENT, again);
    return () => window.removeEventListener(ACTION_CONFIRMED_EVENT, again);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask reads refs and the latest state setter
  }, []);

  usePoll(ask, slow ? IMPORT_POLL_IDLE_INTERVAL_MS : IMPORT_POLL_INTERVAL_MS, heard && importIsMoving(stage));

  let line: string | null = null;
  if (found.status === "mapping") line = t("mapping");
  else if (found.status === "failed") line = t("failed");
  else if (!heard && found.status === "ready") {
    line = t("found", { count: found.itemCount });
    if (found.duplicateCount > 0) line = `${line} ${t("duplicates", { count: found.duplicateCount })}`;
  } else if (!heard && found.status === "parsing") line = t("parsing");

  return (
    <div role="group" aria-label={t("label")} className="ui flex flex-col items-stretch gap-2 border border-border bg-card p-3 text-sm">
      <p className="font-medium">{found.sourceName ?? t("pasted")}</p>
      {line ? <p className="text-muted-foreground">{line}</p> : <ImportProgress view={found} items={items} density="compact" />}
      <div>
        <Button asChild variant="default" size="sm">
          <Link href={href}>{t("review")}</Link>
        </Button>
      </div>
    </div>
  );
}
