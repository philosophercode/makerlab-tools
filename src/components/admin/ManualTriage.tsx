"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import type { TriageTool } from "../../lib/actions/manual-triage";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReviewNote } from "../system/review/ReviewCard";
import { ManualTriageTool } from "./ManualTriageTool";
import {
  chosenReady,
  confirmableIds,
  decidedCount,
  initialRows,
  isBusy,
  isDecided,
  nextUndecided,
  planRowConfirm,
  withOutcomes,
  withStatus,
  type TriageOutcome,
  type TriageRows,
} from "./manual-triage-state";

/**
 * The **Manuals** view of `/admin/proposals` (assistant–GUI parity spec,
 * amendment 2026-10-07 "manual triage"): an assistant's resource proposals,
 * grouped by tool, decided fast.
 *
 * - **Confirm and Dismiss go through `POST /api/action-proposals`**, the
 *   inbox's own route: ids and a decision only, the cookie's person only, and
 *   every rule checked again at the click. Nothing here writes anything else.
 * - **A tool's rows are confirmed together** (`manual-triage-state.ts`), so
 *   the server can confirm them in order without them conflicting with each
 *   other (`revision-chain.ts`). Someone else's edit in between still comes
 *   back as a conflict, shown on the row.
 * - **Keys** work only while focus is inside this view, never while typing in
 *   a field, and never with Ctrl, Alt or Cmd held: `j`/`k` move between tools,
 *   `y` confirms the tool's rows, `n` dismisses them, `o` opens the PDF, `?`
 *   lists the keys. Tab moves as usual; nothing traps it. Every key has a
 *   button that does the same.
 * - **The first tool takes focus when the view opens. After a tool is
 *   decided, focus moves to the next undecided tool**, and the progress line
 *   ("12 of 30 tools decided") is announced politely.
 * - **The tool list stays as it was loaded**: a confirmed change refreshes
 *   the page so each tool's documents are current, but rows keep their own
 *   outcome, and decided tools stay in place.
 */

export function ManualTriage({ tools: loaded }: { tools: TriageTool[] }) {
  const t = useTranslations("actions.triage");
  const router = useRouter();
  // The list as first loaded: a refresh after a confirm drops decided rows
  // from the server's answer, and the view must not reshuffle under the person.
  const [tools] = useState(loaded);
  const documents = useMemo(() => new Map(loaded.map((tool) => [tool.toolId, tool.documents])), [loaded]);
  const [rows, setRows] = useState<TriageRows>(() => initialRows(loaded));
  // The rows as of the last update, for handlers that run across an await.
  const rowsRef = useRef(rows);
  const [active, setActive] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [requestError, setRequestError] = useState(false);
  const sections = useRef<(HTMLElement | null)[]>([]);
  const doneRef = useRef<HTMLParagraphElement | null>(null);

  const decided = decidedCount(tools, rows);
  const allDone = tools.length > 0 && decided === tools.length;

  // Focus moves when the view opens, on j/k, and after a decision: nowhere
  // else. The list never changes, so every section is already in the page.
  const focusTool = (index: number | "done") => {
    if (index === "done") doneRef.current?.focus();
    else sections.current[index]?.focus();
  };
  // The first tool takes focus when the view opens: choosing the Manuals tab
  // is choosing to triage, and the keys work from there at once.
  useEffect(() => {
    sections.current[0]?.focus();
  }, []);

  const update = (next: TriageRows) => {
    rowsRef.current = next;
    setRows(next);
  };

  /** Send one decision for one tool's rows; answers the rows after it. */
  async function send(index: number, ids: string[], decision: "confirm" | "cancel"): Promise<TriageRows> {
    if (ids.length === 0) return rowsRef.current;
    setRequestError(false);
    const before = rowsRef.current;
    update(withStatus(before, ids, "sending"));
    try {
      const res = await fetch("/api/action-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, decision }),
      });
      const body = (await res.json().catch(() => null)) as { results?: TriageOutcome[] } | null;
      if (!res.ok || !body?.results) throw new Error("request refused");
      update(withOutcomes(rowsRef.current, body.results));
      // The tool's documents now include what was just confirmed.
      if (body.results.some((outcome) => outcome.status === "confirmed")) router.refresh();
    } catch {
      setRequestError(true);
      // Nothing changed: each row goes back to what it was.
      update({ ...rowsRef.current, ...Object.fromEntries(ids.map((id) => [id, before[id] ?? { status: "open" as const }])) });
    }
    afterDecision(index);
    return rowsRef.current;
  }

  /** When the tool is now decided, move on to the next undecided one (or the "all done" line). */
  function afterDecision(index: number) {
    const now = rowsRef.current;
    if (!isDecided(tools[index], now)) return;
    const next = nextUndecided(tools, now, index);
    if (next === null) {
      focusTool("done");
      return;
    }
    setActive(next);
    focusTool(next);
  }

  async function confirmRow(index: number, id: string) {
    const plan = planRowConfirm(tools[index], rowsRef.current, id);
    if ("choose" in plan) {
      update(withStatus(rowsRef.current, [plan.choose], "chosen"));
      return;
    }
    await send(index, plan.send, "confirm");
  }

  async function dismissRow(index: number, id: string) {
    const after = await send(index, [id], "cancel");
    // The last open row is gone: the rows chosen meanwhile go now, together.
    const ready = chosenReady(tools[index], after);
    if (ready.length > 0) await send(index, ready, "confirm");
  }

  function undoRow(id: string) {
    update(withStatus(rowsRef.current, [id], "open"));
  }

  async function confirmTool(index: number) {
    const tool = tools[index];
    if (!tool || isBusy(tool, rowsRef.current)) return;
    await send(index, confirmableIds(tool, rowsRef.current), "confirm");
  }

  async function dismissTool(index: number) {
    const tool = tools[index];
    if (!tool || isBusy(tool, rowsRef.current)) return;
    await send(index, confirmableIds(tool, rowsRef.current), "cancel");
  }

  function move(by: number) {
    if (tools.length === 0) return;
    const next = (((active + by) % tools.length) + tools.length) % tools.length;
    setActive(next);
    focusTool(next);
  }

  /** `o`: the focused row's link, else the tool's first row with one, else its first document's. */
  function openFocused(target: HTMLElement) {
    const rowId = target.closest<HTMLElement>("[data-proposal-id]")?.dataset.proposalId;
    const tool = tools[active];
    if (!tool) return;
    const proposal = tool.proposals.find((p) => p.id === rowId && p.openUrl) ?? tool.proposals.find((p) => p.openUrl);
    const url = proposal?.openUrl ?? (documents.get(tool.toolId) ?? tool.documents).find((doc) => doc.url)?.url;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The keys dialog is portalled, but React still bubbles its key events here.
    if (helpOpen || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    // Typing in a field is typing, never a shortcut.
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const handled = (() => {
      switch (event.key) {
        case "j":
          move(1);
          return true;
        case "k":
          move(-1);
          return true;
        case "y":
          void confirmTool(active);
          return true;
        case "n":
          void dismissTool(active);
          return true;
        case "o":
          openFocused(target);
          return true;
        case "?":
          setHelpOpen(true);
          return true;
        default:
          return false;
      }
    })();
    if (handled) event.preventDefault();
  }

  if (tools.length === 0) return <ReviewNote>{t("empty")}</ReviewNote>;

  return (
    <div className="ui flex flex-col gap-4" data-slot="manual-triage" onKeyDown={onKeyDown}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="m-0 font-mono text-label tracking-[0.08em] uppercase" aria-live="polite" data-slot="triage-progress">
          {t("progress", { decided, total: tools.length })}
        </p>
        <p className="m-0 text-xs text-muted-foreground">{t("keysHint")}</p>
        <Button type="button" variant="ghost" size="xs" onClick={() => setHelpOpen(true)} aria-keyshortcuts="?">
          {t("keysButton")}
        </Button>
      </div>

      {requestError ? (
        <ReviewNote tone="bad" role="alert">
          {t("requestFailed")}
        </ReviewNote>
      ) : null}

      {tools.map((tool, index) => (
        <ManualTriageTool
          key={tool.toolId}
          ref={(node) => {
            sections.current[index] = node;
          }}
          tool={tool}
          documents={documents.get(tool.toolId) ?? tool.documents}
          rows={rows}
          active={index === active}
          onFocusTool={() => setActive(index)}
          onConfirmRow={(id) => void confirmRow(index, id)}
          onDismissRow={(id) => void dismissRow(index, id)}
          onUndoRow={undoRow}
          onConfirmTool={() => void confirmTool(index)}
          onDismissTool={() => void dismissTool(index)}
        />
      ))}

      <p ref={doneRef} tabIndex={-1} className="m-0 text-sm text-muted-foreground" data-slot="triage-done">
        {allDone ? t("allDone") : null}
      </p>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent closeLabel={t("keysClose")}>
          <DialogHeader>
            <DialogTitle>{t("keysTitle")}</DialogTitle>
            <DialogDescription>{t("keysIntro")}</DialogDescription>
          </DialogHeader>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {(["j", "k", "y", "n", "o", "?"] as const).map((key) => (
              <div key={key} className="contents">
                <dt>
                  <kbd className="border border-border px-1.5 font-mono text-xs">{key}</kbd>
                </dt>
                <dd className="m-0">{t(`key.${key === "?" ? "help" : key}`)}</dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </div>
  );
}
