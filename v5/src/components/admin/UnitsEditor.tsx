"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { UnitPatch, UnitRecord } from "../../lib/data/units";
import { UNIT_CONDITION, UNIT_STATUS } from "../../lib/db/schema/vocabulary";

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
        <p className="admin-empty td-empty">{t("noUnits")}</p>
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
  const [fields, setFields] = useState({
    unitLabel: unit.unitLabel,
    serialNumber: unit.serialNumber ?? "",
    assetTag: unit.assetTag ?? "",
    dateAcquired: unit.dateAcquired ?? "",
    notes: unit.notes ?? "",
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onEdit(unit.id, {
      unitLabel: fields.unitLabel,
      serialNumber: fields.serialNumber,
      assetTag: fields.assetTag,
      dateAcquired: fields.dateAcquired,
      notes: fields.notes,
    });
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

        <button type="submit" className="admin-button" disabled={pending}>
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
