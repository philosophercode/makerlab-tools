"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { MaintenanceActionError } from "../../../app/admin/maintenance/action-result";
import type { ResolveIssueAction } from "../checklist-issues";
import { ReviewNote } from "../../system/review/ReviewCard";
import { useHydrated } from "../use-hydrated";
import { useRefreshNudge } from "../use-refresh-nudge";

/**
 * **Take it** on an urgent ticket nobody is on, in the overview's Need to know
 * (admin sections spec 2026-10-07): assigns the ticket to the viewer and
 * marks it in progress, through `updateTicket` (`tickets.update`, the same
 * action as the queue's controls). A landed take says "Yours" in place until
 * the page re-renders; a refusal is said under the row.
 */
export function TakeTicketButton({
  ticketId,
  title,
  me,
  action,
}: {
  ticketId: string;
  title: string;
  me: { id: string; name: string };
  action: ResolveIssueAction;
}) {
  const t = useTranslations("admin.overview");
  const te = useTranslations("admin.errors");
  const hydrated = useHydrated();
  const nudge = useRefreshNudge();
  const [pending, setPending] = useState(false);
  const [taken, setTaken] = useState(false);
  const [error, setError] = useState<MaintenanceActionError | null>(null);

  async function take() {
    setPending(true);
    setError(null);
    try {
      const result = await action({
        logId: ticketId,
        patch: { assignedToUserId: me.id, assignedToName: me.name, status: "in_progress" },
      });
      if (result.ok) {
        setTaken(true);
        nudge();
      } else {
        setError(result.error);
      }
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {taken ? (
        <span role="status" className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
          {t("taken")}
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!hydrated || pending}
          aria-label={t("takeFor", { title })}
          onClick={() => void take()}
        >
          {t("take")}
        </Button>
      )}
      {error ? (
        <ReviewNote role="alert" tone="bad">
          {te(error)}
        </ReviewNote>
      ) : null}
    </div>
  );
}
