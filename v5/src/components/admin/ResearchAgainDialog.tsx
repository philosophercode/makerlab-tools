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
  const hintId = useId();
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
      className="admin-intake-redo"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <h4 id={titleId}>{t("redo.title")}</h4>
      <p className="admin-intake-hint">{t("redo.hint")}</p>

      <div className="admin-intake-redo-group" role="group" aria-label={t("redo.focusLegend")}>
        <span className="admin-intake-redo-label" aria-hidden="true">
          {t("redo.focusLegend")}
        </span>
        <div className="admin-intake-chips">
          {choices.map((choice) => {
            const pressed = choice === "everything" ? everything : focus.includes(choice);
            const disabled = choice === "image" && !imageAvailable;
            return (
              <button
                key={choice}
                type="button"
                className={`admin-intake-chip${pressed ? " is-pressed" : ""}`}
                aria-pressed={pressed}
                disabled={disabled}
                title={disabled ? t("redo.imageUnavailable") : undefined}
                onClick={() => toggle(choice)}
              >
                {t(`redo.focus.${choice}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="admin-intake-redo-group" role="group" aria-label={t("redo.suggestionsLabel")}>
        <span className="admin-intake-redo-label" aria-hidden="true">
          {t("redo.suggestionsLabel")}
        </span>
        <div className="admin-intake-chips">
          {SUGGESTIONS.map((key) => (
            <button
              key={key}
              type="button"
              className="admin-intake-chip is-suggestion"
              onClick={() => insert(t(`redo.suggestion.${key}`))}
            >
              {t(`redo.suggestion.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-field">
        <label htmlFor={noteId}>{t("researchNote")}</label>
        <textarea
          id={noteId}
          ref={noteRef}
          rows={3}
          maxLength={REVIEWER_NOTE_MAX_CHARS}
          placeholder={t("researchNotePlaceholder")}
          aria-describedby={hintId}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <p id={hintId} className="admin-intake-hint admin-intake-redo-count">
          <span>{t("redo.noteHint", { max: REVIEWER_NOTE_MAX_CHARS })}</span>
          <span aria-hidden="true">{t("redo.noteCount", { count: note.length, max: REVIEWER_NOTE_MAX_CHARS })}</span>
        </p>
      </div>

      <div className="admin-editor-actions admin-intake-redo-actions">
        <button type="button" className="admin-button is-primary" onClick={submit}>
          {t("redo.submit")}
        </button>
        <button type="button" className="admin-button" onClick={onCancel}>
          {t("redo.cancel")}
        </button>
      </div>
    </section>
  );
}
