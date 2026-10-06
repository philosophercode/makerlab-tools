"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { LabNotesResult } from "../../../app/admin/inventory/lab-notes/action-result";
import type { AdminActionWarning } from "../../../lib/admin/action-result";
import { labNoteLines } from "../../../lib/lab-notes/lines";
import { LAB_NOTES_MAX_CHARS, type LabNotes } from "../../../lib/lab-notes/setting";
import { Field, hintId } from "../../system/Field";
import { Button } from "../../ui/button";
import { Textarea } from "../../ui/textarea";
import { RowStatus } from "../RowStatus";
import { useHydrated } from "../use-hydrated";
import { useRefreshNudge } from "../use-refresh-nudge";

/**
 * The lab-wide notes, edited in place (identity spec amendment "Lab notes").
 * One box, one note per line; saving sends the whole text to `lab.set_notes`
 * through the page's server action, which checks `tools.edit` and the length
 * again. The count under the box says how many notes the assistant will get,
 * read the way it reads them (`labNoteLines`), so a blank line or a typed
 * "- " is never counted as a note. Disabled until hydrated, like every admin
 * form that saves.
 */
export interface LabNotesFormProps {
  /** The stored text, "" when there is none. */
  initial: string;
  save: (input: LabNotes) => Promise<LabNotesResult>;
}

export function LabNotesForm({ initial, save }: LabNotesFormProps) {
  const t = useTranslations("admin.labNotes");
  const hydrated = useHydrated();
  const router = useRouter();
  const nudge = useRefreshNudge();
  const [text, setText] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);
  const tooLong = text.length > LAB_NOTES_MAX_CHARS;
  const notes = labNoteLines(text).length;
  const id = "lab-wide-notes";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (tooLong) return;
    startTransition(async () => {
      const result = await save({ text });
      if (result.ok) {
        setSaved(true);
        setWarning(result.warning ?? null);
        router.refresh();
        nudge();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <form onSubmit={submit} data-slot="lab-notes-form" className="ui flex max-w-[78ch] flex-col gap-3">
      <Field
        id={id}
        label={t("fieldLabel")}
        hint={
          <>
            {t("fieldHint")}{" "}
            <span data-slot="lab-notes-count" className={tooLong ? "text-bad" : undefined}>
              {t("count", { notes, chars: text.length, max: LAB_NOTES_MAX_CHARS })}
            </span>
          </>
        }
      >
        <Textarea
          id={id}
          value={text}
          rows={10}
          placeholder={t("placeholder")}
          aria-describedby={hintId(id)}
          aria-invalid={tooLong || undefined}
          disabled={!hydrated || pending}
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
            setError(null);
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="default" disabled={!hydrated || pending || tooLong}>
          {t("save")}
        </Button>
        <RowStatus pending={pending} saved={saved} error={error} warning={warning} className="basis-auto" />
      </div>
    </form>
  );
}
