"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UnitPatch, UnitRecord } from "../../lib/data/units";
import { UNIT_CONDITION, UNIT_STATUS } from "../../lib/db/schema/vocabulary";
import { EmptyState } from "../system/EmptyState";

/**
 * The Units section of the tool editor (spec §5.3(3), §4.5).
 *
 * The machines behind a tool: add one, correct its serial or asset tag, change
 * its status or condition, retire it, and — only when nothing refers to it —
 * delete it.
 *
 * **Status is the control this section exists for.** A SuperMaker marking a
 * printer out of service is standing next to the machine with one hand free,
 * so each unit's status is a select that saves on change, not a field inside a
 * form somebody has to remember to submit.
 *
 * **Retire is offered beside delete, not instead of it.** A unit with
 * maintenance history cannot be deleted — the server refuses with
 * `unit_has_history` and the panel renders that refusal — so the control that
 * *does* work is always on screen next to the one that usually does not.
 */

export interface UnitsEditorProps {
  units: UnitRecord[];
  pending: boolean;
  onAdd: (unitLabel: string) => void;
  onEdit: (unitId: string, patch: UnitPatch) => void;
  onRetire: (unitId: string) => void;
  onDelete: (unitId: string) => void;
}

export function UnitsEditor({
  units,
  pending,
  onAdd,
  onEdit,
  onRetire,
  onDelete,
}: UnitsEditorProps) {
  const t = useTranslations("admin.inventory.editor");
  const [newLabel, setNewLabel] = useState("");

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    onAdd(label);
    setNewLabel("");
  }

  return (
    <div className="admin-editor-units">
      {units.length === 0 ? (
        // Names what is missing and what would change it (§6, States).
        <EmptyState>{t("noUnits")}</EmptyState>
      ) : (
        <ul className="admin-unit-list">
          {units.map((unit) => (
            <UnitRow
              key={unit.id}
              unit={unit}
              pending={pending}
              onEdit={onEdit}
              onRetire={onRetire}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      <form className="admin-inline-form" onSubmit={handleAdd}>
        <label className="admin-field">
          <span>{t("addUnitLabel")}</span>
          <input
            value={newLabel}
            placeholder={t("addUnitPlaceholder")}
            onChange={(event) => setNewLabel(event.target.value)}
          />
        </label>
        <button type="submit" className="admin-button" disabled={pending || !newLabel.trim()}>
          {t("addUnit")}
        </button>
      </form>
    </div>
  );
}

/**
 * One unit.
 *
 * Its text fields are a small form of their own with a Save of its own, because
 * a serial number is transcribed from a plate and half-typed for a while; the
 * two selects save on change, because that is one decision and one gesture.
 *
 * **It sends only the fields that changed, and it rebases the rest** — the same
 * two rules `ToolFieldsForm` follows, for the same reason and one more. These
 * rows are keyed by unit id, so they never remount when the panel re-reads the
 * list: a row opened ten minutes ago still holds the values it opened with. A
 * patch carrying all five would then post that decade-old copy over whatever
 * somebody else has since typed, and *the revision check cannot see it* — the
 * panel's token is fresh, the write is accepted, and a serial number somebody
 * transcribed off the machine is gone with no conflict and no audit event.
 *
 * So: a field the person has not touched follows the server (that is what makes
 * the panel's conflict reload honest for this section), a field they have
 * touched is theirs and is never overwritten, and Save posts the second kind
 * only. `notes` has no box here at all, which under the old rule meant every
 * save rewrote it from whatever the panel had last read.
 */
function UnitRow({
  unit,
  pending,
  onEdit,
  onRetire,
  onDelete,
}: {
  unit: UnitRecord;
  pending: boolean;
  onEdit: (unitId: string, patch: UnitPatch) => void;
  onRetire: (unitId: string) => void;
  onDelete: (unitId: string) => void;
}) {
  const t = useTranslations("admin.inventory.editor");

  const server = textOf(unit);
  /** What the server said when these boxes were last rebased onto it. */
  const [baseline, setBaseline] = useState(server);
  const [fields, setFields] = useState(server);

  // Adjusting state while rendering, rather than in an effect: React re-renders
  // this component before anything reaches the screen, so the boxes never show
  // the old value for a frame. (The React docs' "adjusting state when a prop
  // changes" pattern.)
  if (!sameText(baseline, server)) {
    setFields((current) => rebase(current, baseline, server));
    setBaseline(server);
  }

  const changed = changedText(fields, baseline);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (Object.keys(changed).length === 0) return;
    onEdit(unit.id, changed);
  }

  return (
    <li className="admin-unit" aria-label={unit.unitLabel}>
      <form className="admin-unit-fields" onSubmit={handleSubmit}>
        <label className="admin-field">
          <span>{t("unitLabel")}</span>
          <input
            value={fields.unitLabel}
            onChange={(event) => setFields({ ...fields, unitLabel: event.target.value })}
          />
        </label>

        <label className="admin-field">
          <span>{t("unitSerial")}</span>
          <input
            value={fields.serialNumber}
            onChange={(event) => setFields({ ...fields, serialNumber: event.target.value })}
          />
        </label>

        <label className="admin-field">
          <span>{t("unitAssetTag")}</span>
          <input
            value={fields.assetTag}
            onChange={(event) => setFields({ ...fields, assetTag: event.target.value })}
          />
        </label>

        <label className="admin-field">
          <span>{t("unitDateAcquired")}</span>
          <input
            type="date"
            value={fields.dateAcquired}
            onChange={(event) => setFields({ ...fields, dateAcquired: event.target.value })}
          />
        </label>

        {/* Nothing to save is a disabled button, not a click that quietly
            writes nothing — the same rule Add unit follows above. */}
        <button
          type="submit"
          className="admin-button"
          disabled={pending || Object.keys(changed).length === 0}
        >
          {t("saveUnit")}
        </button>
      </form>

      <div className="admin-unit-state">
        <label className="admin-field">
          <span>{t("unitStatus")}</span>
          <select
            value={unit.status}
            disabled={pending}
            onChange={(event) => onEdit(unit.id, { status: event.target.value })}
          >
            {UNIT_STATUS.map((status) => (
              <option key={status} value={status}>
                {t(`unitStatusOption.${status}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="admin-field">
          <span>{t("unitCondition")}</span>
          <select
            value={unit.condition ?? ""}
            disabled={pending}
            onChange={(event) =>
              onEdit(unit.id, { condition: event.target.value || null })
            }
          >
            {/* Unknown is a value here, not an absence: it is the honest answer
                for most imported units (§4.5). */}
            <option value="">{t("unitConditionUnknown")}</option>
            {UNIT_CONDITION.map((condition) => (
              <option key={condition} value={condition}>
                {t(`unitConditionOption.${condition}`)}
              </option>
            ))}
          </select>
        </label>

        <div className="admin-unit-actions">
          <button
            type="button"
            className="admin-button"
            disabled={pending || unit.status === "retired"}
            onClick={() => onRetire(unit.id)}
          >
            {t("retireUnit")}
          </button>
          <button
            type="button"
            className="admin-button is-danger"
            disabled={pending}
            onClick={() => onDelete(unit.id)}
          >
            {t("deleteUnit")}
          </button>
        </div>
      </div>
    </li>
  );
}

// ── The five typed fields, and the three rules about them ───────────
//
// Kept together at the bottom of the file because they are one idea in three
// parts: what the server says, what the boxes hold, and which of the two wins
// for each field.

/** The fields a person types. `status` and `condition` are chosen, not typed. */
type UnitText = Pick<
  UnitRecord,
  "unitLabel" | "serialNumber" | "assetTag" | "dateAcquired" | "notes"
>;

type UnitTextKey = keyof UnitText;

const TEXT_KEYS: readonly UnitTextKey[] = [
  "unitLabel",
  "serialNumber",
  "assetTag",
  "dateAcquired",
  "notes",
];

/** A unit as boxes hold it: an absent value is an empty box, never "null". */
function textOf(unit: UnitRecord): Record<UnitTextKey, string> {
  return {
    unitLabel: unit.unitLabel,
    serialNumber: unit.serialNumber ?? "",
    assetTag: unit.assetTag ?? "",
    dateAcquired: unit.dateAcquired ?? "",
    notes: unit.notes ?? "",
  };
}

function sameText(
  a: Record<UnitTextKey, string>,
  b: Record<UnitTextKey, string>
): boolean {
  return TEXT_KEYS.every((key) => a[key] === b[key]);
}

/**
 * The server moved. Take its value for every field this person has left alone,
 * and keep theirs for every field they have not — nothing copies a fresh value
 * over a box somebody is typing in.
 */
function rebase(
  current: Record<UnitTextKey, string>,
  baseline: Record<UnitTextKey, string>,
  server: Record<UnitTextKey, string>
): Record<UnitTextKey, string> {
  const next = { ...current };
  for (const key of TEXT_KEYS) {
    if (current[key] === baseline[key]) next[key] = server[key];
  }
  return next;
}

/** Only what this person changed, which is the only thing Save may post. */
function changedText(
  fields: Record<UnitTextKey, string>,
  baseline: Record<UnitTextKey, string>
): UnitPatch {
  const patch: UnitPatch = {};
  for (const key of TEXT_KEYS) {
    if (fields[key] !== baseline[key]) patch[key] = fields[key];
  }
  return patch;
}
