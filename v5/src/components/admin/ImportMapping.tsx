"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { columnMapProblem, IMPORT_FIELDS, type ColumnMap, type ImportField } from "../../lib/import/columns";
import { IMPORT_MAX_ITEMS } from "../../lib/import/limits";
import type { TablePreview } from "../../lib/import/preview";

/**
 * The mapping step (bulk intake spec §5 step 1): the first rows of the table,
 * a match under each column — suggested from its header — and **Continue**,
 * which creates the rows. Without a column for the name it asks for one and
 * will not continue (§5 unhappy paths).
 */
export function ImportMapping({
  preview,
  busy,
  error,
  onConfirm,
}: {
  preview: TablePreview;
  busy: boolean;
  /** A message key under `admin.import.errors`, or null. */
  error: string | null;
  onConfirm: (map: ColumnMap) => void;
}) {
  const t = useTranslations("admin.import");
  const [map, setMap] = useState<ColumnMap>(preview.suggested);
  const problem = columnMapProblem(map, preview.headers.length);

  function choose(column: number, value: string) {
    setMap((current) => current.map((field, index) => (index === column ? (value ? (value as ImportField) : null) : field)));
  }

  return (
    <section className="admin-import-mapping" aria-labelledby="import-mapping-title">
      <h3 id="import-mapping-title">{t("mapping.title")}</h3>
      <p className="admin-intake-hint">{t("mapping.lede", { count: preview.rowCount })}</p>
      {preview.hasHeader ? null : <p className="admin-intake-hint">{t("mapping.noHeader")}</p>}
      <div className="admin-table-scroll">
        <table className="admin-table admin-import-preview">
          <thead>
            <tr>
              {preview.headers.map((header, column) => (
                <th key={column} scope="col">
                  <span className="admin-import-header">{header}</span>
                  <select
                    aria-label={t("mapping.columnFor", { header })}
                    value={map[column] ?? ""}
                    onChange={(event) => choose(column, event.target.value)}
                    disabled={busy}
                  >
                    <option value="">{t("mapping.ignore")}</option>
                    {IMPORT_FIELDS.map((field) => (
                      <option key={field} value={field}>
                        {t(`mapping.field.${field}`)}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, index) => (
              <tr key={index}>
                {preview.headers.map((_, column) => (
                  <td key={column}>{row[column]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {problem === "no_name" ? (
        <p className="admin-row-status is-error" role="alert">
          {t("mapping.needName")}
        </p>
      ) : problem === "duplicate_field" ? (
        <p className="admin-row-status is-error" role="alert">
          {t("errors.duplicate_field")}
        </p>
      ) : null}
      {error ? (
        <p className="admin-row-status is-error" role="alert">
          {t(`errors.${error}`, { count: preview.rowCount, limit: IMPORT_MAX_ITEMS })}
        </p>
      ) : null}
      <div className="admin-editor-actions">
        <button type="button" className="admin-button is-primary" disabled={busy || problem !== null} onClick={() => onConfirm(map)}>
          {busy ? t("mapping.creating") : t("mapping.continue", { count: preview.rowCount })}
        </button>
      </div>
    </section>
  );
}
