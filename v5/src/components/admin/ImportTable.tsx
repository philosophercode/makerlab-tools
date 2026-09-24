"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { RowPatch } from "../../app/admin/intake/imports/action-result";
import { IMPORT_MAX_QUANTITY } from "../../lib/import/limits";
import type { ImportItemView } from "../../lib/import/view";
import { intakeItemPath } from "../../app/admin/intake/action-result";
import { isFlagged, sameImportTarget } from "./import-table";

/**
 * The review table's rows (bulk intake spec §5 step 3, §6): one line per
 * item — select, row number, name, brand, category, location, quantity, lab
 * documents, duplicate status, the suggested name, the status. Every box saves
 * when it loses focus with a changed value; nothing here writes on its own.
 *
 * Below 720 px the same rows stack as cards (`admin-import.css`), like the
 * chat's intake table.
 */

export interface ImportTableProps {
  rows: ImportItemView[];
  byId: ReadonlyMap<string, ImportItemView>;
  selected: ReadonlySet<string>;
  locked: boolean;
  categories: string[];
  locations: string[];
  onToggle: (id: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onPatch: (id: string, patch: RowPatch) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onAccept: (ids: string[]) => void;
  onIgnore: (ids: string[]) => void;
}

const EDITABLE = new Set(["identified", "researched", "failed"]);

export function ImportTable(props: ImportTableProps) {
  const t = useTranslations("admin.import");
  const { rows, selected, locked } = props;
  const allShown = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return (
    <div className="admin-table-scroll admin-import-table-wrap">
      <datalist id="import-categories">
        {props.categories.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="import-locations">
        {props.locations.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <table className="admin-table admin-import-table">
        <thead>
          <tr>
            <th scope="col">
              <input
                type="checkbox"
                aria-label={t("review.selectAllShown")}
                checked={allShown}
                disabled={locked || rows.length === 0}
                onChange={(event) => props.onToggleAll(event.target.checked)}
              />
            </th>
            <th scope="col">{t("col.row")}</th>
            <th scope="col">{t("col.name")}</th>
            <th scope="col">{t("col.brand")}</th>
            <th scope="col">{t("col.category")}</th>
            <th scope="col">{t("col.location")}</th>
            <th scope="col">{t("col.quantity")}</th>
            <th scope="col">{t("col.labDocs")}</th>
            <th scope="col">{t("col.duplicate")}</th>
            <th scope="col">{t("col.suggestion")}</th>
            <th scope="col">{t("col.status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ImportRow key={`${row.id}:${row.updatedAt}`} row={row} {...props} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImportRow({
  row,
  byId,
  selected,
  locked,
  onToggle,
  onPatch,
  onMerge,
  onAccept,
  onIgnore,
}: ImportTableProps & { row: ImportItemView }) {
  const t = useTranslations("admin.import");
  const editable = EDITABLE.has(row.status) && !locked;
  const label = row.sourceRow !== null ? t("rowNumber", { row: row.sourceRow }) : "";

  /** Save a text box when it loses focus with a different value. */
  const commit = (field: "name" | "brand" | "categoryHint" | "locationHint", value: string, current: string | null) => {
    const next = value.trim();
    if (next === (current ?? "")) return;
    if (field === "name") {
      if (next) onPatch(row.id, { name: next });
      return;
    }
    onPatch(row.id, { [field]: next || null });
  };

  return (
    <tr className={`admin-import-row is-${row.status}${isFlagged(row) ? " is-flagged" : ""}`}>
      <td data-label={t("col.select")}>
        <input
          type="checkbox"
          aria-label={t("review.selectRow", { name: row.name })}
          checked={selected.has(row.id)}
          disabled={locked}
          onChange={(event) => onToggle(row.id, event.target.checked)}
        />
      </td>
      <td data-label={t("col.row")} className="admin-import-rownum">
        {row.sourceRow ?? "—"}
      </td>
      <td data-label={t("col.name")}>
        <input
          className="admin-import-input is-name"
          aria-label={t("review.nameFor", { row: label })}
          defaultValue={row.name}
          maxLength={200}
          disabled={!editable}
          onBlur={(event) => commit("name", event.target.value, row.name)}
        />
        {row.notes ? <span className="admin-import-notes">{row.notes}</span> : null}
      </td>
      <td data-label={t("col.brand")}>
        <input
          className="admin-import-input"
          aria-label={t("review.brandFor", { name: row.name })}
          defaultValue={row.brand ?? ""}
          maxLength={200}
          disabled={!editable}
          onBlur={(event) => commit("brand", event.target.value, row.brand)}
        />
      </td>
      <td data-label={t("col.category")}>
        <input
          className="admin-import-input"
          list="import-categories"
          aria-label={t("review.categoryFor", { name: row.name })}
          defaultValue={row.categoryHint ?? ""}
          maxLength={200}
          disabled={!editable}
          onBlur={(event) => commit("categoryHint", event.target.value, row.categoryHint)}
        />
      </td>
      <td data-label={t("col.location")}>
        <input
          className="admin-import-input"
          list="import-locations"
          aria-label={t("review.locationFor", { name: row.name })}
          defaultValue={row.locationHint ?? ""}
          maxLength={200}
          disabled={!editable}
          onBlur={(event) => commit("locationHint", event.target.value, row.locationHint)}
        />
      </td>
      <td data-label={t("col.quantity")}>
        <input
          className="admin-import-input is-quantity"
          type="number"
          min={Math.max(1, row.serials.length)}
          max={IMPORT_MAX_QUANTITY}
          aria-label={t("review.quantityFor", { name: row.name })}
          defaultValue={row.quantity}
          disabled={!editable}
          onBlur={(event) => {
            const value = Number(event.target.value);
            if (Number.isInteger(value) && value >= 1 && value <= IMPORT_MAX_QUANTITY && value !== row.quantity) {
              onPatch(row.id, { quantity: value });
            }
          }}
        />
        {row.serials.length > 0 ? (
          <span className="admin-import-notes" title={row.serials.join(", ")}>
            {t("review.serials", { count: row.serials.length })}
          </span>
        ) : null}
      </td>
      <td data-label={t("col.labDocs")}>
        {row.labDocs.length === 0 ? (
          <span className="admin-import-muted">—</span>
        ) : (
          <ul className="admin-import-docs">
            {row.labDocs.map((doc) => (
              <li key={doc.url}>
                <a href={doc.url} target="_blank" rel="noopener noreferrer">
                  {doc.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </td>
      <td data-label={t("col.duplicate")}>
        <DuplicateCell row={row} byId={byId} editable={editable} onPatch={onPatch} onMerge={onMerge} />
      </td>
      <td data-label={t("col.suggestion")}>
        {row.nameSuggestion ? (
          <div className="admin-import-suggestion">
            <span>
              {row.nameSuggestion.canonicalName}{" "}
              <span className={`admin-state is-${row.nameSuggestion.confidence}`}>
                {t(`confidence.${row.nameSuggestion.confidence}`)}
              </span>
            </span>
            {row.nameSuggestion.sourceUrl ? (
              <a href={row.nameSuggestion.sourceUrl} target="_blank" rel="noopener noreferrer">
                {t("suggestion.source")}
              </a>
            ) : null}
            <span className="admin-editor-actions">
              <button type="button" className="admin-button" disabled={!editable} onClick={() => onAccept([row.id])}>
                {t("suggestion.accept")}
              </button>
              <button type="button" className="admin-button" disabled={!editable} onClick={() => onIgnore([row.id])}>
                {t("suggestion.ignore")}
              </button>
            </span>
          </div>
        ) : (
          <span className="admin-import-muted">—</span>
        )}
      </td>
      <td data-label={t("col.status")}>
        {row.status === "researched" || row.status === "failed" ? (
          <Link href={intakeItemPath(row.id)}>{t(`rowStatus.${row.status}`)}</Link>
        ) : (
          t(`rowStatus.${row.status}`)
        )}
      </td>
    </tr>
  );
}

/**
 * What the duplicate check found, and the choice it asks for: another unit of
 * a matched tool, a different tool, merging into the earlier row of this same
 * import (the same machine listed twice), or removing the row.
 */
function DuplicateCell({
  row,
  byId,
  editable,
  onPatch,
  onMerge,
}: {
  row: ImportItemView;
  byId: ReadonlyMap<string, ImportItemView>;
  editable: boolean;
  onPatch: (id: string, patch: RowPatch) => void;
  onMerge: (sourceId: string, targetId: string) => void;
}) {
  const t = useTranslations("admin.import");
  const match = row.duplicateOf;
  if (!match) return <span className="admin-import-muted">—</span>;
  const target = sameImportTarget(row, byId);
  const text =
    match.kind === "tool"
      ? t("dup.tool", { name: match.name })
      : target
        ? t("dup.sameImport", { row: target.sourceRow ?? "?" })
        : t("dup.pending", { name: match.name });

  return (
    <div className="admin-import-duplicate">
      <span>{text}</span>
      <select
        aria-label={t("dup.decideFor", { name: row.name })}
        value={row.duplicateResolution ?? ""}
        disabled={!editable || row.status !== "identified"}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "merge" && target) onMerge(row.id, target.id);
          else if (value === "add_unit" || value === "new_tool" || value === "discard") onPatch(row.id, { duplicateResolution: value });
        }}
      >
        <option value="" disabled>
          {t("dup.decide")}
        </option>
        {match.kind === "tool" ? <option value="add_unit">{t("dup.addUnit")}</option> : null}
        {target ? <option value="merge">{t("dup.merge", { row: target.sourceRow ?? "?" })}</option> : null}
        <option value="new_tool">{t("dup.newTool")}</option>
        <option value="discard">{t("dup.remove")}</option>
      </select>
    </div>
  );
}
