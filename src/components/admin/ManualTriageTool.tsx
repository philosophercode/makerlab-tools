"use client";

import { forwardRef } from "react";
import { useTranslations } from "next-intl";
import type { TriageDocument, TriageTool } from "../../lib/actions/manual-triage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "../system/StatusGlyph";
import { ManualTriageRow, shortLink } from "./ManualTriageRow";
import { confirmableIds, isBusy, isDecided, type TriageRows } from "./manual-triage-state";

/**
 * One tool in the Manuals view (assistant–GUI parity spec, amendment
 * 2026-10-07): its name and picture, the documents it has now, and each
 * proposed change as a row. **Confirm all for this tool** sends every row
 * still open or chosen in one request, oldest first, so they confirm in order
 * instead of conflicting with each other.
 *
 * The section is focusable (`tabIndex={-1}`, never in the Tab order): the
 * view moves focus here with j/k and after a decision. Presentational.
 */

export interface ManualTriageToolProps {
  tool: TriageTool;
  /** Today's documents: refreshed after a confirm, while the rows keep their own state. */
  documents: readonly TriageDocument[];
  rows: TriageRows;
  active: boolean;
  onFocusTool: () => void;
  onConfirmRow: (id: string) => void;
  onDismissRow: (id: string) => void;
  onUndoRow: (id: string) => void;
  onConfirmTool: () => void;
  onDismissTool: () => void;
}

export const ManualTriageTool = forwardRef<HTMLElement, ManualTriageToolProps>(function ManualTriageTool(
  { tool, documents, rows, active, onFocusTool, onConfirmRow, onDismissRow, onUndoRow, onConfirmTool, onDismissTool },
  ref
) {
  const t = useTranslations("actions.triage");
  const headingId = `triage-tool-${tool.toolId}`;
  const decided = isDecided(tool, rows);
  const busy = isBusy(tool, rows);
  const confirmable = confirmableIds(tool, rows);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      data-slot="triage-tool"
      data-tool-id={tool.toolId}
      data-decided={decided ? "true" : "false"}
      data-active={active ? "true" : "false"}
      onFocus={onFocusTool}
      className={cn(
        "flex flex-col gap-3 border border-border border-s-4 p-3 sm:p-4",
        active ? "border-s-primary-ink" : "border-s-transparent",
        decided && "bg-muted/40"
      )}
    >
      <header className="flex flex-wrap items-center gap-3">
        {tool.photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a small stored thumbnail; nothing for next/image to do
          <img src={tool.photo} alt="" width={40} height={40} loading="lazy" decoding="async" className="size-10 border border-border bg-muted object-cover" />
        ) : (
          <span aria-hidden="true" className="grid size-10 place-items-center border border-dashed border-input text-micro text-muted-foreground">
            —
          </span>
        )}
        <h3 id={headingId} className="m-0 min-w-0 flex-1 font-heading text-lg font-medium break-words uppercase">
          {tool.link ? (
            <a href={tool.link} className="hover:underline" target="_blank" rel="noopener noreferrer">
              {tool.name}
              <span className="sr-only">{` ${t("opensNewTab")}`}</span>
            </a>
          ) : (
            tool.name
          )}
        </h3>
        <StatusGlyph
          tone={decided ? "ok" : "active"}
          label={decided ? t("toolDecided") : t("toolWaiting", { count: confirmable.length })}
        />
      </header>

      <div className="flex flex-col gap-1">
        <h4 className="m-0 font-mono text-micro font-normal tracking-[0.08em] text-muted-foreground uppercase">{t("current")}</h4>
        {documents.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{t("noDocuments")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm" data-slot="triage-documents">
            {documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-foreground">{doc.title}</span>
                {doc.type ? <span className="text-xs text-muted-foreground">{doc.type}</span> : null}
                {doc.url ? (
                  <a href={doc.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary-ink hover:underline" title={doc.url}>
                    {shortLink(doc.url)}
                    <span className="sr-only">{` ${t("opensNewTab")}`}</span>
                  </a>
                ) : null}
                {doc.pages !== null ? <span className="text-xs text-muted-foreground">{t("pages", { count: doc.pages })}</span> : null}
                {doc.hidden ? <span className="text-xs text-warn">{t("hiddenYes")}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="m-0 flex list-none flex-col p-0" aria-label={t("proposalsLabel", { tool: tool.name })}>
        {tool.proposals.map((proposal) => (
          <ManualTriageRow
            key={proposal.id}
            proposal={proposal}
            state={rows[proposal.id] ?? { status: "open" }}
            busy={busy}
            onConfirm={() => onConfirmRow(proposal.id)}
            onDismiss={() => onDismissRow(proposal.id)}
            onUndo={() => onUndoRow(proposal.id)}
          />
        ))}
      </ul>

      {confirmable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <Button type="button" variant="default" size="sm" disabled={busy} onClick={onConfirmTool}>
            {confirmable.length > 1 ? t("confirmToolCount", { count: confirmable.length }) : t("confirmTool")}
          </Button>
          <Button type="button" variant="quiet" size="sm" disabled={busy} onClick={onDismissTool}>
            {t("dismissTool")}
          </Button>
          {busy ? (
            <span role="status" className="text-xs text-muted-foreground">
              {t("saving")}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});
