"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { REVIEWER_NOTE_MAX_CHARS } from "../../lib/intake/limits";
import {
  RESEARCH_FOCUS_FIELDS,
  type ResearchFocusChoice,
  type ResearchFocusField,
} from "../../lib/intake/research-focus";
import { cleanReviewerNote } from "../../lib/intake/reviewer-note";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, hintId } from "../system/Field";
import { ReviewNote } from "../system/review/ReviewCard";

/**
 * **Research again**, guided (amendment "Guided redo (focus + guidance)"): the
 * small panel the button opens *in place*, under the identity fields — never a
 * browser modal (§6) — asking "Anything to focus on?".
 *
 * - **Focus** is a row of toggle chips. **Everything** starts pressed; pressing
 *   a field presses it alone (Everything lets go), and letting go of the last
 *   field falls back to Everything. Image is off when the item has its own
 *   photo — research never looks for one then.
 * - **Quick suggestions** put their words into the note — appended after what
 *   is already there, never past the cap. "Wrong model or variant — it's …"
 *   leaves the cursor after "it's " for the reviewer to finish.
 * - **The note** is the reviewer's instruction, one paragraph of up to
 *   `REVIEWER_NOTE_MAX_CHARS`; line breaks become spaces when it is sent
 *   (`cleanReviewerNote`), as the server would make them anyway.
 *
 * It sends nothing itself: `onSubmit` gets the focus (null for everything) and
 * the cleaned note (null for none), and the page does the rest.
 */

export interface ResearchAgainDialogProps {
  /** What the box starts with: the note the last research ran with. */
  initialNote: string;
  /** False when the item has an uploaded photo — then Image cannot be chosen. */
  imageAvailable: boolean;
  onSubmit: (request: { focus: ResearchFocusField[] | null; note: string | null }) => void;
  onCancel: () => void;
}

/** The suggestions, in the order shown; each is a message key under `redo.suggestion`. */
const SUGGESTIONS = ["specs", "manual", "variant", "shorter"] as const;

export function ResearchAgainDialog({ initialNote, imageAvailable, onSubmit, onCancel }: ResearchAgainDialogProps) {
  const t = useTranslations("admin.intake");
  const titleId = useId();
  const noteId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);

  const [focus, setFocus] = useState<ResearchFocusField[]>([]);
  const [note, setNote] = useState(initialNote.slice(0, REVIEWER_NOTE_MAX_CHARS));
  /** A suggestion was just inserted: once React has written it, put the cursor at its end. */
  const caretToEnd = useRef(false);
  useLayoutEffect(() => {
    const box = noteRef.current;
    if (!caretToEnd.current || !box) return;
    caretToEnd.current = false;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [note]);

  const everything = focus.length === 0;

  function toggle(choice: ResearchFocusChoice) {
    if (choice === "everything") {
      setFocus([]);
      return;
    }
    setFocus((current) =>
      current.includes(choice)
        ? current.filter((field) => field !== choice)
        : RESEARCH_FOCUS_FIELDS.filter((field) => field === choice || current.includes(field))
    );
  }

  /** Put a suggestion's words into the note, after what is there, within the cap. */
  function insert(text: string) {
    const words = text.replace(/\s*…$/, " ");
    const current = note.trimEnd();
    const joined = current ? `${current}${/[.!?]$/.test(current) ? " " : ". "}${words}` : words;
    caretToEnd.current = true;
    setNote(joined.slice(0, REVIEWER_NOTE_MAX_CHARS));
  }

  function submit() {
    onSubmit({ focus: everything ? null : focus, note: cleanReviewerNote(note) || null });
  }

  const choices: ResearchFocusChoice[] = ["everything", ...RESEARCH_FOCUS_FIELDS];

  return (
    <section
      className="ui flex flex-col gap-3 border-s-2 border-s-primary-ink bg-muted p-3"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <h4 id={titleId} className="m-0 font-mono text-label font-medium text-foreground uppercase">
        {t("redo.title")}
      </h4>
      <ReviewNote>{t("redo.hint")}</ReviewNote>

      <div className="flex flex-col gap-1.5" role="group" aria-label={t("redo.focusLegend")}>
        <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase" aria-hidden="true">
          {t("redo.focusLegend")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {choices.map((choice) => {
            const pressed = choice === "everything" ? everything : focus.includes(choice);
            const disabled = choice === "image" && !imageAvailable;
            return (
              <Button
                key={choice}
                size="sm"
                variant={pressed ? "outline" : "quiet"}
                className={cn(pressed && "border-primary-ink bg-primary/10")}
                aria-pressed={pressed}
                disabled={disabled}
                title={disabled ? t("redo.imageUnavailable") : undefined}
                onClick={() => toggle(choice)}
              >
                {t(`redo.focus.${choice}`)}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5" role="group" aria-label={t("redo.suggestionsLabel")}>
        <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase" aria-hidden="true">
          {t("redo.suggestionsLabel")}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((key) => (
            // A suggestion is words for the note, not a setting: sentence case, dashed.
            <Button
              key={key}
              size="sm"
              variant="quiet"
              className="border-dashed font-sans text-table normal-case"
              onClick={() => insert(t(`redo.suggestion.${key}`))}
            >
              {t(`redo.suggestion.${key}`)}
            </Button>
          ))}
        </div>
      </div>

      <Field
        id={noteId}
        label={t("researchNote")}
        hint={
          <span className="flex justify-between gap-3">
            <span>{t("redo.noteHint", { max: REVIEWER_NOTE_MAX_CHARS })}</span>
            <span aria-hidden="true" className="shrink-0 font-mono tabular-nums">
              {t("redo.noteCount", { count: note.length, max: REVIEWER_NOTE_MAX_CHARS })}
            </span>
          </span>
        }
      >
        <Textarea
          id={noteId}
          ref={noteRef}
          rows={3}
          maxLength={REVIEWER_NOTE_MAX_CHARS}
          placeholder={t("researchNotePlaceholder")}
          aria-describedby={hintId(noteId)}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button variant="default" size="sm" onClick={submit}>
          {t("redo.submit")}
        </Button>
        <Button size="sm" onClick={onCancel}>
          {t("redo.cancel")}
        </Button>
      </div>
    </section>
  );
}
