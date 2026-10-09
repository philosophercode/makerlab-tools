"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MaintenanceActionError } from "../../app/admin/maintenance/action-result";
import { ReviewNote } from "../system/review/ReviewCard";
import type { ChecklistIssue, ResolveIssueAction } from "./checklist-issues";
import { useHydrated } from "./use-hydrated";
import { useRefreshNudge } from "./use-refresh-nudge";

/**
 * **Mark resolved** on an open issue under a Shift checklist task (recurring
 * maintenance spec, amendment 2026-10-07). One click sets the ticket's status
 * to `resolved` through `updateTicket`, the same action the queue's status
 * select uses (`tickets.update`: `maintenance.manage`, the mirror told, the
 * kiosk count and tool pages refreshed).
 *
 * Disabled until hydrated (DESIGN.md §8.14). A landed change is said in place
 * ("Resolved: …") until the page re-renders without the ticket; a refusal is
 * said beside the control and the button comes back.
 */
export function ResolveIssueControl({ issue, action }: { issue: ChecklistIssue; action: ResolveIssueAction }) {
  const t = useTranslations("admin.schedules.due");
  const te = useTranslations("admin.errors");
  const tw = useTranslations("admin.warnings");
  const tp = useTranslations("admin.maintenance");
  const hydrated = useHydrated();
  const nudge = useRefreshNudge();
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ kind: "resolved"; warned: boolean } | { kind: "error"; error: MaintenanceActionError } | null>(null);

  async function resolve() {
    setPending(true);
    setState(null);
    try {
      const result = await action({ logId: issue.id, patch: { status: "resolved" } });
      if (result.ok) {
        setState({ kind: "resolved", warned: Boolean(result.warning) });
        nudge();
      } else {
        setState({ kind: "error", error: result.error });
      }
    } catch {
      setState({ kind: "error", error: "failed" });
    } finally {
      setPending(false);
    }
  }

  const priority = issue.priority && tp.has(`priority.${issue.priority}` as "priority.high") ? tp(`priority.${issue.priority}` as "priority.high") : null;

  return (
    <li className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm">
          {issue.title}
          {priority ? <span className="ms-2 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{priority}</span> : null}
        </span>
        {state?.kind === "resolved" ? (
          <span role="status" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("resolved", { title: issue.title })}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!hydrated || pending}
            aria-label={t("markResolvedFor", { title: issue.title })}
            onClick={() => void resolve()}
          >
            {t("markResolved")}
          </Button>
        )}
      </div>
      {state?.kind === "resolved" && state.warned ? (
        <ReviewNote role="status" tone="warn">
          {tw("audit_unavailable")}
        </ReviewNote>
      ) : null}
      {state?.kind === "error" ? (
        <ReviewNote role="alert" tone="bad">
          {te(state.error)}
        </ReviewNote>
      ) : null}
    </li>
  );
}
