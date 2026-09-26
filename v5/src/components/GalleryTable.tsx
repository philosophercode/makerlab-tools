"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { MakerLabTool } from "./catalog-types";
import { DataTable } from "./system/data-table/DataTable";
import { StatusGlyph } from "./system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "./ToolCard";
import { ToolImage } from "./ToolImage";
import { availableUnits } from "./gallery-filters";

/**
 * The gallery's table view (UI system spec §8.2) on the shared `DataTable`:
 * a real `<table>` with `aria-sort` on the header cell — the old view was a
 * div grid whose sort buttons carried `aria-sort`, which no screen reader
 * reads there. The rows arrive already filtered, ranked and sorted by `GalleryShell`;
 * with no column sorted they keep that order, and a header sorts on top of
 * it. Enter on a row opens the tool. On a phone each tool is a two-line item.
 */
export function GalleryTable({
  tools,
  label,
  stickyHeader,
  keyboardHint,
}: {
  tools: MakerLabTool[];
  /** The table's name: the gallery's, or its section's when grouped. */
  label?: string;
  /** Off under a group's own sticky heading. */
  stickyHeader?: boolean;
  /** Said once, not under every group's table. */
  keyboardHint?: boolean;
}) {
  const t = useTranslations("gallery");
  const router = useRouter();

  const columns = useMemo<ColumnDef<MakerLabTool, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (tool) => tool.name,
        header: t("columnTool"),
        meta: { rowHeader: true, className: "w-[26%] whitespace-normal" },
        cell: ({ row }) => (
          <span className="flex items-center gap-3">
            <Thumb tool={row.original} />
            <Link href={`/tools/${row.original.slug}`} className="font-medium hover:text-primary-ink hover:underline">
              {row.original.name}
            </Link>
          </span>
        ),
      },
      {
        id: "status",
        accessorFn: (tool) => tool.status,
        header: t("columnStatus"),
        meta: { className: "w-[16%]" },
        cell: ({ row }) => (
          <StatusGlyph
            tone={TOOL_STATUS_TONE[row.original.status]}
            label={t(`status.${TOOL_STATUS_KEY[row.original.status]}`)}
          />
        ),
      },
      { id: "category", accessorFn: (tool) => tool.category ?? "", header: t("columnCategory"), meta: { className: "w-[13%]" } },
      { id: "location", accessorFn: (tool) => tool.location ?? "", header: t("columnLocation"), meta: { className: "w-[13%]" } },
      { id: "zone", accessorFn: (tool) => tool.zone ?? "", header: t("columnZone"), meta: { className: "w-[11%]" } },
      { id: "training", accessorFn: (tool) => tool.trainingLevel ?? "", header: t("columnTraining"), meta: { className: "w-[11%]" } },
      {
        id: "available",
        accessorFn: (tool) => availableUnits(tool),
        header: t("columnAvailable"),
        meta: { align: "right", className: "w-[10%]" },
        cell: ({ row }) => {
          const available = availableUnits(row.original);
          return (
            <span className={available === 0 ? "text-muted-foreground" : undefined}>
              {available}
              <span className="text-muted-foreground">/{row.original.units.length}</span>
            </span>
          );
        },
      },
    ],
    [t]
  );

  return (
    <DataTable
      data={tools}
      columns={columns}
      getRowId={getRowId}
      getRowName={getRowName}
      labels={{ table: label ?? t("toolGalleryLabel") }}
      stickyHeader={stickyHeader}
      keyboardHint={keyboardHint}
      empty={null}
      onActivate={(tool) => router.push(`/tools/${tool.slug}`)}
      mobileRow={(tool) => (
        <Link href={`/tools/${tool.slug}`} className="flex items-center gap-3 px-1 py-2">
          <Thumb tool={tool} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{tool.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[t(`status.${TOOL_STATUS_KEY[tool.status]}`), tool.category, tool.zone].filter(Boolean).join(" · ")}
            </span>
          </span>
        </Link>
      )}
    />
  );
}

const getRowId = (tool: MakerLabTool) => tool.id;
const getRowName = (tool: MakerLabTool) => tool.name;

/** 24px, contained: a product shot, not a crop. Decorative — the name is beside it. */
function Thumb({ tool }: { tool: MakerLabTool }) {
  return <ToolImage src={tool.imageSrc} name={tool.name} sizes="24px" className="size-6 shrink-0 border border-border bg-card text-[8px]" />;
}
