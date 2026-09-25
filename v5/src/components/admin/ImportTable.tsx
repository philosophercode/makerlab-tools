"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef, RowSelectionState } from "@tanstack/react-table";
import type { RowPatch } from "../../app/admin/intake/imports/action-result";
import { IMPORT_MAX_QUANTITY } from "../../lib/import/limits";
import type { ImportItemView } from "../../lib/import/view";
import { intakeItemPath } from "../../app/admin/intake/action-result";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DataTable } from "../system/data-table/DataTable";
import { Field } from "../system/Field";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import { DuplicateChoice } from "../system/review/DuplicateChoice";
import { ReviewCard } from "../system/review/ReviewCard";
import { sameImportTarget } from "./import-table";
import { PENDING_STATUS_TONE } from "./pending-status-tone";

/**
 * The review table's rows (bulk intake spec §5 step 3, §6): one line per
 * item — select, row number, name, brand, category, location, quantity, lab
 * documents, duplicate status, the suggested name, the status. Every box saves
 * when it loses focus with a changed value; nothing here writes on its own.
 *
 * Since UI system phase 3 it is the shared `DataTable` (selection over the rows
 * shown, a sticky bulk bar the page fills) and the duplicate is decided with
 * `DuplicateChoice`. On a phone each row is a compact `ReviewCard` with the
 * same boxes, labelled. A box is uncontrolled and keyed by the row's
 * `updatedAt`, so a change the server answered with replaces what it shows.
 */

export interface ImportTableProps {
  rows: ImportItemView[];
  byId: ReadonlyMap<string, ImportItemView>;
  selected: ReadonlySet<string>;
  locked: boolean;
  categories: string[];
  locations: string[];
  onSelectionChange: (next: Set<string>) => void;
  onPatch: (id: string, patch: RowPatch) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onAccept: (ids: string[]) => void;
  onIgnore: (ids: string[]) => void;
  /** The sticky bar's actions while rows are selected. */
  bulkActions: (selectedIds: string[], clear: () => void) => ReactNode;
  /** Shown instead of the table when no row is shown. */
  empty: ReactNode;
}

const EDITABLE = new Set(["identified", "researched", "failed"]);

const SUGGESTION_TONE: Record<string, StatusTone> = { exact: "ok", likely: "warn", unsure: "idle" };

type TextField = "name" | "brand" | "categoryHint" | "locationHint";

/** What one row's cells need: whether it can change, and how it saves. */
interface RowContext {
  row: ImportItemView;
  editable: boolean;
  commit: (field: TextField, value: string, current: string | null) => void;
  quantity: (value: string) => void;
}

export function ImportTable(props: ImportTableProps) {
  const t = useTranslations("admin.import");
  const { rows, byId, selected, locked } = props;

  function contextOf(row: ImportItemView): RowContext {
    return {
      row,
      editable: EDITABLE.has(row.status) && !locked,
      commit(field, value, current) {
        const next = value.trim();
        if (next === (current ?? "")) return;
        if (field === "name") {
          if (next) props.onPatch(row.id, { name: next });
          return;
        }
        props.onPatch(row.id, { [field]: next || null });
      },
      quantity(raw) {
        const value = Number(raw);
        if (Number.isInteger(value) && value >= 1 && value <= IMPORT_MAX_QUANTITY && value !== row.quantity) {
          props.onPatch(row.id, { quantity: value });
        }
      },
    };
  }

  const columns: ColumnDef<ImportItemView, unknown>[] = [
    {
      id: "row",
      accessorFn: (row) => row.sourceRow ?? 0,
      header: t("col.row"),
      meta: { align: "right", cellClassName: "align-top text-muted-foreground" },
      cell: ({ row }) => row.original.sourceRow ?? "—",
    },
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: t("col.name"),
      meta: { rowHeader: true, cellClassName: "align-top whitespace-normal" },
      cell: ({ row }) => (
        <div className="flex min-w-40 flex-col gap-0.5">
          <TextBox
            ctx={contextOf(row.original)}
            field="name"
            label={t("review.nameFor", {
              row: row.original.sourceRow !== null ? t("rowNumber", { row: row.original.sourceRow }) : "",
            })}
          />
          {row.original.notes ? <span className="text-xs text-muted-foreground">{row.original.notes}</span> : null}
        </div>
      ),
    },
    {
      id: "brand",
      header: t("col.brand"),
      enableSorting: false,
      meta: { cellClassName: "align-top" },
      cell: ({ row }) => (
        <TextBox ctx={contextOf(row.original)} field="brand" label={t("review.brandFor", { name: row.original.name })} />
      ),
    },
    {
      id: "category",
      header: t("col.category"),
      enableSorting: false,
      meta: { cellClassName: "align-top" },
      cell: ({ row }) => (
        <TextBox
          ctx={contextOf(row.original)}
          field="categoryHint"
          list="import-categories"
          label={t("review.categoryFor", { name: row.original.name })}
        />
      ),
    },
    {
      id: "location",
      header: t("col.location"),
      enableSorting: false,
      meta: { cellClassName: "align-top" },
      cell: ({ row }) => (
        <TextBox
          ctx={contextOf(row.original)}
          field="locationHint"
          list="import-locations"
          label={t("review.locationFor", { name: row.original.name })}
        />
      ),
    },
    {
      id: "quantity",
      accessorFn: (row) => row.quantity,
      header: t("col.quantity"),
      meta: { align: "right", cellClassName: "align-top" },
      cell: ({ row }) => <Quantity ctx={contextOf(row.original)} />,
    },
    {
      id: "labDocs",
      header: t("col.labDocs"),
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal" },
      cell: ({ row }) => <LabDocs row={row.original} />,
    },
    {
      id: "duplicate",
      header: t("col.duplicate"),
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal min-w-56" },
      cell: ({ row }) => (
        <Duplicate ctx={contextOf(row.original)} byId={byId} onPatch={props.onPatch} onMerge={props.onMerge} />
      ),
    },
    {
      id: "suggestion",
      header: t("col.suggestion"),
      enableSorting: false,
      meta: { cellClassName: "align-top whitespace-normal min-w-48" },
      cell: ({ row }) => (
        <Suggestion ctx={contextOf(row.original)} onAccept={props.onAccept} onIgnore={props.onIgnore} />
      ),
    },
    {
      id: "status",
      accessorFn: (row) => row.status,
      header: t("col.status"),
      meta: { cellClassName: "align-top" },
      cell: ({ row }) => <Status row={row.original} />,
    },
  ];

  const selection: RowSelectionState = Object.fromEntries([...selected].map((id) => [id, true]));

  return (
    <>
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
      <DataTable
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        getRowName={(row) => row.name}
        labels={{ table: t("review.tableLabel"), selected: (count) => t("review.selectedCount", { count }) }}
        empty={props.empty}
        selectable
        alignTop
        canSelectRow={() => !locked}
        selection={selection}
        onSelectionChange={(next) => props.onSelectionChange(new Set(Object.keys(next).filter((id) => next[id])))}
        bulkActions={props.bulkActions}
        rowClassName={(row) => (row.duplicateOf && row.duplicateResolution === null ? "bg-muted/60" : undefined)}
        mobileRow={(row, state) => (
          <MobileRow
            ctx={contextOf(row)}
            selected={state.selected}
            canSelect={state.canSelect}
            onToggle={state.toggle}
            byId={byId}
            onPatch={props.onPatch}
            onMerge={props.onMerge}
            onAccept={props.onAccept}
            onIgnore={props.onIgnore}
          />
        )}
      />
    </>
  );
}

/** One text box in a row: uncontrolled, keyed by the row's `updatedAt`, saved on blur when it changed. */
function TextBox({ ctx, field, label, list }: { ctx: RowContext; field: TextField; label: string; list?: string }) {
  const current = ctx.row[field];
  return (
    <Input
      key={ctx.row.updatedAt}
      className="h-7 min-w-28 text-table"
      list={list}
      aria-label={label}
      defaultValue={current ?? ""}
      maxLength={200}
      disabled={!ctx.editable}
      onBlur={(event) => ctx.commit(field, event.target.value, current)}
    />
  );
}

function Quantity({ ctx, id }: { ctx: RowContext; id?: string }) {
  const t = useTranslations("admin.import");
  const { row } = ctx;
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Input
        key={row.updatedAt}
        id={id}
        className="h-7 w-16 text-end font-mono text-table tabular-nums"
        type="number"
        min={Math.max(1, row.serials.length)}
        max={IMPORT_MAX_QUANTITY}
        aria-label={id ? undefined : t("review.quantityFor", { name: row.name })}
        defaultValue={row.quantity}
        disabled={!ctx.editable}
        onBlur={(event) => ctx.quantity(event.target.value)}
      />
      {row.serials.length > 0 ? (
        <span className="text-xs text-muted-foreground" title={row.serials.join(", ")}>
          {t("review.serials", { count: row.serials.length })}
        </span>
      ) : null}
    </div>
  );
}

function LabDocs({ row }: { row: ImportItemView }) {
  if (row.labDocs.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-col gap-0.5 text-table">
      {row.labDocs.map((doc) => (
        <li key={doc.url}>
          <a href={doc.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
            {doc.title}
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the duplicate check found, and the choice it asks for: another unit of
 * a matched tool, a different tool, merging into the earlier row of this same
 * import (the same machine listed twice), or removing the row. Choosing saves.
 */
function Duplicate({
  ctx,
  byId,
  onPatch,
  onMerge,
}: {
  ctx: RowContext;
  byId: ReadonlyMap<string, ImportItemView>;
  onPatch: (id: string, patch: RowPatch) => void;
  onMerge: (sourceId: string, targetId: string) => void;
}) {
  const t = useTranslations("admin.import");
  const { row } = ctx;
  const match = row.duplicateOf;
  if (!match) return <span className="text-muted-foreground">—</span>;
  const target = sameImportTarget(row, byId);
  const text =
    match.kind === "tool"
      ? t("dup.tool", { name: match.name })
      : target
        ? t("dup.sameImport", { row: target.sourceRow ?? "?" })
        : t("dup.pending", { name: match.name });

  type Choice = "add_unit" | "merge" | "new_tool" | "discard";
  const options: { value: Choice; label: string }[] = [
    ...(match.kind === "tool" ? [{ value: "add_unit" as const, label: t("dup.addUnit") }] : []),
    ...(target ? [{ value: "merge" as const, label: t("dup.merge", { row: target.sourceRow ?? "?" }) }] : []),
    { value: "new_tool", label: t("dup.newTool") },
    { value: "discard", label: t("dup.remove") },
  ];

  return (
    <DuplicateChoice<Choice>
      label={t("dup.decideFor", { name: row.name })}
      match={text}
      options={options}
      value={row.duplicateResolution}
      disabled={!ctx.editable || row.status !== "identified"}
      onChoose={(value) => {
        if (value === "merge" && target) onMerge(row.id, target.id);
        else if (value !== "merge") onPatch(row.id, { duplicateResolution: value });
      }}
    />
  );
}

function Suggestion({
  ctx,
  onAccept,
  onIgnore,
}: {
  ctx: RowContext;
  onAccept: (ids: string[]) => void;
  onIgnore: (ids: string[]) => void;
}) {
  const t = useTranslations("admin.import");
  const suggestion = ctx.row.nameSuggestion;
  if (!suggestion) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1 text-table">
      <span>
        {suggestion.canonicalName}{" "}
        {suggestion.displayName && suggestion.displayName !== suggestion.canonicalName ? (
          <span className="text-muted-foreground">{t("suggestion.showsAs", { name: suggestion.displayName })} </span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <StatusGlyph tone={SUGGESTION_TONE[suggestion.confidence] ?? "idle"} label={t(`confidence.${suggestion.confidence}`)} />
        {suggestion.sourceUrl ? (
          <a
            href={suggestion.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary-ink underline-offset-2 hover:underline"
          >
            {t("suggestion.source")}
          </a>
        ) : null}
      </span>
      <span className="flex gap-1">
        <Button size="xs" disabled={!ctx.editable} onClick={() => onAccept([ctx.row.id])}>
          {t("suggestion.accept")}
        </Button>
        <Button variant="ghost" size="xs" disabled={!ctx.editable} onClick={() => onIgnore([ctx.row.id])}>
          {t("suggestion.ignore")}
        </Button>
      </span>
    </div>
  );
}

function Status({ row }: { row: ImportItemView }) {
  const t = useTranslations("admin.import");
  const glyph = <StatusGlyph tone={PENDING_STATUS_TONE[row.status]} label={t(`rowStatus.${row.status}`)} />;
  return row.status === "researched" || row.status === "failed" ? (
    <Link href={intakeItemPath(row.id)} className="underline-offset-2 hover:underline">
      {glyph}
    </Link>
  ) : (
    glyph
  );
}

/** A row on a phone: a compact review card with the same boxes, each labelled. */
function MobileRow({
  ctx,
  selected,
  canSelect,
  onToggle,
  byId,
  onPatch,
  onMerge,
  onAccept,
  onIgnore,
}: {
  ctx: RowContext;
  selected: boolean;
  canSelect: boolean;
  onToggle: () => void;
  byId: ReadonlyMap<string, ImportItemView>;
  onPatch: (id: string, patch: RowPatch) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onAccept: (ids: string[]) => void;
  onIgnore: (ids: string[]) => void;
}) {
  const t = useTranslations("admin.import");
  const tc = useTranslations("admin.import.col");
  const { row } = ctx;
  const id = (field: string) => `import-${row.id}-${field}`;
  const box = (field: TextField, label: string, list?: string) => (
    <Field id={id(field)} label={label}>
      <Input
        key={row.updatedAt}
        id={id(field)}
        className="h-8 text-table"
        list={list}
        defaultValue={row[field] ?? ""}
        maxLength={200}
        disabled={!ctx.editable}
        onBlur={(event) => ctx.commit(field, event.target.value, row[field])}
      />
    </Field>
  );
  return (
    <ReviewCard
      label={row.sourceRow !== null ? `${t("rowNumber", { row: row.sourceRow })} · ${row.name}` : row.name}
      tone={row.duplicateOf && row.duplicateResolution === null ? "warn" : "default"}
      className="border-b-0"
      media={
        <Checkbox
          aria-label={t("review.selectRow", { name: row.name })}
          checked={selected}
          disabled={!canSelect}
          onCheckedChange={onToggle}
        />
      }
      marks={<Status row={row} />}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">{box("name", tc("name"))}</div>
        {box("brand", tc("brand"))}
        <Field id={id("quantity")} label={tc("quantity")}>
          <Quantity ctx={ctx} id={id("quantity")} />
        </Field>
        {box("categoryHint", tc("category"), "import-categories")}
        {box("locationHint", tc("location"), "import-locations")}
      </div>
      {row.notes ? <p className="text-xs text-muted-foreground">{row.notes}</p> : null}
      {row.labDocs.length > 0 ? <LabDocs row={row} /> : null}
      {row.duplicateOf ? <Duplicate ctx={ctx} byId={byId} onPatch={onPatch} onMerge={onMerge} /> : null}
      {row.nameSuggestion ? <Suggestion ctx={ctx} onAccept={onAccept} onIgnore={onIgnore} /> : null}
    </ReviewCard>
  );
}
