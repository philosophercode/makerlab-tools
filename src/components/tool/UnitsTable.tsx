"use client";

import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { MakerLabUnit } from "../catalog-types";
import { DataTable } from "../system/data-table/DataTable";
import { StatusGlyph } from "../system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "../ToolCard";
import { isoDay } from "../../lib/iso-day";

/**
 * The tool page's machines (UI system phase 5a): a small `DataTable` — unit as
 * the row's name, status as glyph + word, condition in words (warn / bad ink
 * only when it needs a person), the serial in mono, the acquisition date ISO
 * and right-aligned. On a phone, a two-line item per unit.
 */
export function UnitsTable({ units }: { units: MakerLabUnit[] }) {
  const t = useTranslations("detail");
  const tStatus = useTranslations("gallery.status");

  const status = (unit: MakerLabUnit) => (
    <StatusGlyph tone={TOOL_STATUS_TONE[unit.status]} label={tStatus(TOOL_STATUS_KEY[unit.status])} />
  );
  const condition = (unit: MakerLabUnit) => (
    <span className={unit.condition === "Offline" ? "text-bad" : unit.condition === "Service Soon" ? "text-warn" : undefined}>
      {unit.condition}
    </span>
  );

  const columns: ColumnDef<MakerLabUnit, unknown>[] = [
    {
      id: "unit",
      accessorFn: (unit) => unit.name,
      header: t("unit"),
      meta: { rowHeader: true, className: "font-medium whitespace-normal" },
    },
    { id: "location", accessorFn: (unit) => unit.location, header: t("location") },
    { id: "status", accessorFn: (unit) => unit.status, header: t("status"), cell: ({ row }) => status(row.original) },
    { id: "condition", accessorFn: (unit) => unit.condition, header: t("condition"), cell: ({ row }) => condition(row.original) },
    {
      id: "serial",
      accessorFn: (unit) => unit.serial,
      header: t("serial"),
      cell: ({ row }) => <code className="font-mono text-xs">{row.original.serial || "–"}</code>,
    },
    {
      id: "acquired",
      accessorFn: (unit) => unit.dateAcquired ?? "",
      header: t("acquired"),
      meta: { align: "right" },
      cell: ({ row }) => isoDay(row.original.dateAcquired) || <span className="text-muted-foreground">–</span>,
    },
  ];

  return (
    <DataTable
      data={units}
      columns={columns}
      getRowId={(unit) => unit.id}
      getRowName={(unit) => unit.name}
      labels={{ table: t("physicalMachines") }}
      empty={null}
      keyboardHint={false}
      stickyHeader={false}
      mobileRow={(unit) => (
        <div className="flex flex-col gap-1 px-1 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong className="text-sm">{unit.name}</strong>
            {status(unit)}
          </div>
          <div className="text-xs text-muted-foreground">
            {[unit.location, unit.serial, isoDay(unit.dateAcquired)].filter(Boolean).join(" · ")} · {condition(unit)}
          </div>
        </div>
      )}
    />
  );
}
