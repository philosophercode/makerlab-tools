"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CompleteScheduleAction, ScheduleActionError } from "../../app/admin/maintenance/schedule-result";
import { ReviewNote } from "../system/review/ReviewCard";
import { useHydrated } from "./use-hydrated";

/**
 * **Done** on a recurring task (recurring maintenance spec, amendment
 * 2026-10-06): one click checks it off for today. **Add a note** opens a
 * field first, for "replaced the filter" or "cleaner is running low"; the
 * note rides on the same Done.
 *
 * The due date the person saw travels with the click, so a task somebody else
 * checked off a moment ago answers `conflict` instead of being logged twice.
 * A refusal keeps the note and says why beside the control; a landed check-off
 * is reported by the caller (`onDone`), because this row usually leaves the
 * due list when the page re-renders.
 */

export interface TaskDoneControlProps {
  scheduleId: string;
  title: string;
  /** The task's next due date as shown — the click's conflict check. */
  dueOn: string;
  action: CompleteScheduleAction;
  onDone: (result: { title: string; nextDueOn: string; unaudited: boolean }) => void;
}

export function TaskDoneControl({ scheduleId, title, dueOn, action, onDone }: TaskDoneControlProps) {
  const t = useTranslations("admin.schedules");
  const te = useTranslations("admin.errors");
  const hydrated = useHydrated();
  const id = useId();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ScheduleActionError | null>(null);

  async function done() {
    setPending(true);
    setError(null);
    try {
      const result = await action({ scheduleId, note, expectedDueOn: dueOn });
      if (result.ok) {
        setNote("");
        setNoteOpen(false);
        onDone({ title, nextDueOn: result.nextDueOn, unaudited: Boolean(result.warning) });
        return;
      }
      setError(result.error);
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          // A list of these is never "the one primary" (DESIGN.md §8.10).
          variant="outline"
          disabled={!hydrated || pending}
          aria-label={t("doneFor", { title })}
          onClick={() => void done()}
        >
          {t("done")}
        </Button>
        {!noteOpen ? (
          <Button type="button" size="sm" variant="ghost" disabled={!hydrated || pending} onClick={() => setNoteOpen(true)}>
            {t("addNote")}
          </Button>
        ) : null}
      </div>
      {noteOpen ? (
        <div className="flex max-w-[60ch] flex-col gap-1">
          <label htmlFor={`${id}-note`} className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
            {t("noteLabel")}
          </label>
          <Textarea
            id={`${id}-note`}
            rows={2}
            maxLength={1000}
            value={note}
            disabled={pending}
            placeholder={t("notePlaceholder")}
            aria-label={t("noteFor", { title })}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setNote("");
                setNoteOpen(false);
              }
            }}
          />
        </div>
      ) : null}
      {error ? (
        <ReviewNote role="alert" tone="bad">
          {te(error)}
        </ReviewNote>
      ) : null}
    </div>
  );
}
