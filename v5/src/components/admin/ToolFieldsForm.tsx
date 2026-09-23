"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CategoryOption, LocationOption } from "../../lib/data/taxonomy";
import type { EditableTool, ToolPatch } from "../../lib/data/tools";
import { STARTER_QUESTION_MAX_CHARS, STARTER_QUESTIONS_MAX } from "../../lib/starter-questions";

/**
 * The tool's own fields, in the editor panel (spec §5.3(3)).
 *
 * **It sends only what changed.** `updateTool` writes exactly the keys it is
 * given, so a form that posted every field would overwrite somebody else's
 * edit to a field this person never touched — with a value this panel read
 * before they made it.
 *
 * **It is rebased, not synchronised.** The draft starts from `values` and is
 * never quietly replaced: a `useEffect` that copied fresh server values over
 * the boxes would delete what somebody was typing. The panel rebases it when
 * it wants to, by remounting with a new `key` after a save it knows landed.
 *
 * **`theirs` is the conflict case, and it is the point of the whole exercise.**
 * After a conflict the panel reloads the newer version and passes it here;
 * every field where the two disagree shows the other person's value beside the
 * box, with a control that takes it. Nothing anybody typed is thrown away and
 * nothing is overwritten unseen (§6, States).
 */

export interface ToolFieldsFormProps {
  values: EditableTool;
  categories: CategoryOption[];
  locations: LocationOption[];
  /** The newer version, after a conflict reload. Null the rest of the time. */
  theirs?: EditableTool | null;
  /** True while any write on the panel is in flight. */
  pending: boolean;
  onSave: (patch: ToolPatch) => void;
}

/** The editable text of one tool, flattened so the form can diff it. */
interface Draft {
  name: string;
  description: string;
  categoryId: string;
  locationId: string;
  materials: string;
  ppeRequired: string;
  tags: string;
  trainingRequired: boolean;
  useRestrictions: string;
  emergencyStop: string;
  notes: string;
  /**
   * The assistant's starter questions, one per line, always
   * {@link STARTER_QUESTIONS_MAX} lines (blank for an empty slot) — a string so
   * the conflict diff treats it like every other field.
   */
  starterQuestions: string;
}

/** The three list fields, entered as comma-separated text because they are chips. */
const LIST_FIELDS = ["materials", "ppeRequired", "tags"] as const;

export function ToolFieldsForm({
  values,
  categories,
  locations,
  theirs = null,
  pending,
  onSave,
}: ToolFieldsFormProps) {
  const t = useTranslations("admin.inventory.editor");
  // Initialised once. See the note above about rebasing rather than syncing.
  const [draft, setDraft] = useState<Draft>(() => toDraft(values));

  const base = toDraft(values);
  const theirDraft = theirs ? toDraft(theirs) : null;

  function set<K extends keyof Draft>(field: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onSave(patchOf(base, draft));
  }

  /**
   * What the other person's version of this field says, when it differs from
   * what is in the box. Null whenever there is nothing to choose between.
   */
  function conflictOf(field: keyof Draft): string | null {
    if (!theirDraft) return null;
    const mine = draft[field];
    const other = theirDraft[field];
    if (mine === other) return null;
    if (field === "starterQuestions") return questionLines(other as string).join(" · ");
    return typeof other === "boolean" ? (other ? t("yes") : t("no")) : other;
  }

  /**
   * The other person's version of one field, or nothing.
   *
   * A function rather than a nested component: a component declared inside a
   * render is a new type every render, so React would unmount and remount the
   * node — and the button inside it would lose focus mid-conflict.
   */
  function theirValue(field: keyof Draft) {
    const other = conflictOf(field);
    if (other === null || !theirDraft) return null;

    return (
      <span className="admin-field-theirs">
        <span>{t("theirValue", { value: other || t("empty") })}</span>
        <button type="button" onClick={() => set(field, theirDraft[field] as never)}>
          {t("useTheirs")}
        </button>
      </span>
    );
  }

  return (
    <form className="admin-editor-form" onSubmit={handleSubmit}>
      {/* Every field is a wrapper with an explicit `htmlFor` rather than a
          label wrapped around its control: the conflict note sits beside the
          box, and a note *inside* the label would become part of the field's
          accessible name — the label would read "Description Their version: …". */}
      <div className="admin-field">
        <label htmlFor="tool-name">{t("fieldName")}</label>
        <input
          id="tool-name"
          value={draft.name}
          required
          onChange={(event) => set("name", event.target.value)}
        />
        {theirValue("name")}
      </div>

      <div className="admin-field">
        <label htmlFor="tool-description">{t("fieldDescription")}</label>
        <textarea
          id="tool-description"
          value={draft.description}
          rows={4}
          onChange={(event) => set("description", event.target.value)}
        />
        {theirValue("description")}
      </div>

      <div className="admin-field">
        <label htmlFor="tool-category">{t("fieldCategory")}</label>
        <select
          id="tool-category"
          value={draft.categoryId}
          onChange={(event) => set("categoryId", event.target.value)}
        >
          <option value="">{t("noneSelected")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.group ? `${category.group} — ${category.name}` : category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="admin-field">
        <label htmlFor="tool-location">{t("fieldLocation")}</label>
        <select
          id="tool-location"
          value={draft.locationId}
          onChange={(event) => set("locationId", event.target.value)}
        >
          <option value="">{t("noneSelected")}</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {`${location.room} — ${location.zone}`}
            </option>
          ))}
        </select>
      </div>

      {LIST_FIELDS.map((field) => (
        <div className="admin-field" key={field}>
          <label htmlFor={`tool-${field}`}>{t(`field_${field}`)}</label>
          {/* Comma-separated because these render as chips and are edited two
              or three at a time; a tag editor is a component nobody asked for. */}
          <input
            id={`tool-${field}`}
            value={draft[field]}
            placeholder={t("listPlaceholder")}
            onChange={(event) => set(field, event.target.value)}
          />
          {theirValue(field)}
        </div>
      ))}

      <div className="admin-field is-check">
        <input
          id="tool-training-required"
          type="checkbox"
          checked={draft.trainingRequired}
          onChange={(event) => set("trainingRequired", event.target.checked)}
        />
        <label htmlFor="tool-training-required">{t("fieldTrainingRequired")}</label>
        {theirValue("trainingRequired")}
      </div>

      <div className="admin-field">
        <label htmlFor="tool-use-restrictions">{t("fieldUseRestrictions")}</label>
        <input
          id="tool-use-restrictions"
          value={draft.useRestrictions}
          onChange={(event) => set("useRestrictions", event.target.value)}
        />
        {theirValue("useRestrictions")}
      </div>

      <div className="admin-field">
        <label htmlFor="tool-emergency-stop">{t("fieldEmergencyStop")}</label>
        <input
          id="tool-emergency-stop"
          value={draft.emergencyStop}
          onChange={(event) => set("emergencyStop", event.target.value)}
        />
        {theirValue("emergencyStop")}
      </div>

      <fieldset className="admin-field">
        <legend>{t("fieldStarterQuestions")}</legend>
        <p className="admin-field-hint">{t("starterQuestionsHint")}</p>
        {slots(draft.starterQuestions).map((question, n) => (
          <input
            key={n}
            id={`tool-starter-question-${n + 1}`}
            aria-label={t("starterQuestionN", { n: n + 1 })}
            value={question}
            maxLength={STARTER_QUESTION_MAX_CHARS}
            onChange={(event) => {
              const next = slots(draft.starterQuestions);
              next[n] = event.target.value.replace(/\n/g, " ");
              set("starterQuestions", next.join("\n"));
            }}
          />
        ))}
        {theirValue("starterQuestions")}
      </fieldset>

      <div className="admin-field">
        <label htmlFor="tool-notes">{t("fieldNotes")}</label>
        <textarea
          id="tool-notes"
          value={draft.notes}
          rows={3}
          onChange={(event) => set("notes", event.target.value)}
        />
        {theirValue("notes")}
      </div>

      <div className="admin-editor-actions">
        <button type="submit" className="admin-button is-primary" disabled={pending}>
          {t("saveFields")}
        </button>
      </div>
    </form>
  );
}

/** A tool row as editable text. Nulls become "", which is what an input holds. */
function toDraft(tool: EditableTool): Draft {
  return {
    name: tool.name,
    description: tool.description ?? "",
    categoryId: tool.categoryId ?? "",
    locationId: tool.locationId ?? "",
    materials: tool.materials.join(", "),
    ppeRequired: tool.ppeRequired.join(", "),
    tags: tool.tags.join(", "),
    trainingRequired: tool.trainingRequired,
    useRestrictions: tool.useRestrictions ?? "",
    emergencyStop: tool.emergencyStop ?? "",
    notes: tool.notes ?? "",
    starterQuestions: slots((tool.starterQuestions ?? []).join("\n")).join("\n"),
  };
}

/** The draft's lines, exactly {@link STARTER_QUESTIONS_MAX} of them. */
function slots(value: string): string[] {
  const lines = value.split("\n").slice(0, STARTER_QUESTIONS_MAX);
  while (lines.length < STARTER_QUESTIONS_MAX) lines.push("");
  return lines;
}

/** The draft's non-blank lines, trimmed — what a save sends. */
function questionLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Only the fields this person actually changed.
 *
 * An empty patch is still sent: `updateTool` treats it as a touch, which moves
 * the revision and tells anybody else's open panel that this one was here. The
 * alternative — refusing to save when nothing changed — would make "Save" do
 * nothing visible and leave people pressing it again.
 */
function patchOf(base: Draft, draft: Draft): ToolPatch {
  const patch: ToolPatch = {};

  if (draft.name !== base.name) patch.name = draft.name;
  if (draft.description !== base.description) patch.description = draft.description;
  if (draft.categoryId !== base.categoryId) patch.categoryId = draft.categoryId || null;
  if (draft.locationId !== base.locationId) patch.locationId = draft.locationId || null;
  if (draft.trainingRequired !== base.trainingRequired) {
    patch.trainingRequired = draft.trainingRequired;
  }
  if (draft.useRestrictions !== base.useRestrictions) {
    patch.useRestrictions = draft.useRestrictions;
  }
  if (draft.emergencyStop !== base.emergencyStop) patch.emergencyStop = draft.emergencyStop;
  if (draft.notes !== base.notes) patch.notes = draft.notes;
  if (draft.starterQuestions !== base.starterQuestions) {
    patch.starterQuestions = questionLines(draft.starterQuestions);
  }

  // The three list fields share a key name with their `ToolPatch` entry, which
  // is what lets one loop cover them.
  for (const field of LIST_FIELDS) {
    if (draft[field] !== base[field]) patch[field] = splitList(draft[field]);
  }

  return patch;
}

/** "PLA, resin" → ["PLA", "resin"]. Blanks dropped; the data layer trims too. */
function splitList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
