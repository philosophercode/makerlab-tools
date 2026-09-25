"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { columnMapProblem, IMPORT_FIELDS, type ColumnMap, type ImportField } from "../../lib/import/columns";
import { IMPORT_MAX_ITEMS } from "../../lib/import/limits";
import type { TablePreview } from "../../lib/import/preview";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { DataTable } from "../system/data-table/DataTable";
import { ReviewNote } from "../system/review/ReviewCard";

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

  // The preview is the table as it will be read: one column per source column,
  // each headed by what it holds. Short and read-only, so it stays a table on a
  // phone and scrolls sideways inside itself (DESIGN.md §8.3).
  const columns: ColumnDef<PreviewRow, unknown>[] = preview.headers.map((header, column) => ({
    id: `c${column}`,
    enableSorting: false,
    meta: { label: header, cellClassName: "whitespace-normal" },
    header: () => (
      <span className="flex min-w-36 flex-col gap-1 normal-case">
        <span className="font-mono text-micro tracking-[0.08em] uppercase">{header}</span>
        <NativeSelect
          size="sm"
          className="w-full"
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
        </NativeSelect>
      </span>
    ),
    cell: ({ row }) => row.original.cells[column],
  }));

  return (
    <section aria-labelledby="import-mapping-title" className="ui flex flex-col gap-3">
      <h3 id="import-mapping-title" className="m-0 font-heading text-lg font-medium uppercase">
        {t("mapping.title")}
      </h3>
      <ReviewNote>{t("mapping.lede", { count: preview.rowCount })}</ReviewNote>
      {preview.hasHeader ? null : <ReviewNote tone="warn">{t("mapping.noHeader")}</ReviewNote>}
      <DataTable
        data={preview.rows.map((cells, index) => ({ id: String(index), cells }))}
        columns={columns}
        getRowId={(row) => row.id}
        getRowName={(row) => row.cells[0] ?? row.id}
        labels={{ table: t("mapping.title") }}
        empty={null}
        stickyHeader={false}
      />
      {problem === "no_name" ? (
        <ReviewNote tone="bad" role="alert">
          {t("mapping.needName")}
        </ReviewNote>
      ) : problem === "duplicate_field" ? (
        <ReviewNote tone="bad" role="alert">
          {t("errors.duplicate_field")}
        </ReviewNote>
      ) : null}
      {error ? (
        <ReviewNote tone="bad" role="alert">
          {t(`errors.${error}`, { count: preview.rowCount, limit: IMPORT_MAX_ITEMS })}
        </ReviewNote>
      ) : null}
      <Button variant="default" className="self-start" disabled={busy || problem !== null} onClick={() => onConfirm(map)}>
        {busy ? t("mapping.creating") : t("mapping.continue", { count: preview.rowCount })}
      </Button>
    </section>
  );
}

interface PreviewRow {
  id: string;
  cells: string[];
}
