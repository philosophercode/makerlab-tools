"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { MakerLabTool } from "./catalog-types";
import { DataTable } from "./system/data-table/DataTable";
import { StatusGlyph } from "./system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "./ToolCard";
import { ToolImage } from "./ToolImage";
import { GALLERY_STATUSES, availableUnits } from "./gallery-filters";

/**
 * The gallery's table view on the shared `DataTable` — the inventory's
 * controls for the public catalogue (public polish): every column sorts (a
 * header click sorts on top of the filtered, ranked order), the Columns menu
 * in the toolbar hides the ones a reader does not need (official name and
 * materials start hidden), rows are dense with a sticky header, the keyboard
 * moves between rows and Enter opens the tool, and a phone gets a two-line
 * item per tool.
 *
 * The columns are built by {@link useGalleryColumns}, which `GalleryShell`
 * also hands its `ColumnsMenu`, so the menu and every grouped section's table
 * share one visibility state.
 */

/** Hidden until asked for: useful, but not what somebody scanning the lab needs. */
export const GALLERY_DEFAULT_HIDDEN: VisibilityState = { officialName: false, materials: false };

export function useGalleryColumns(): ColumnDef<MakerLabTool, unknown>[] {
  const t = useTranslations("gallery");
  return useMemo<ColumnDef<MakerLabTool, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (tool) => tool.name,
        header: t("columnTool"),
        enableHiding: false,
        meta: { label: t("columnTool"), rowHeader: true, className: "w-[24%] whitespace-normal" },
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
        id: "officialName",
        accessorFn: (tool) => tool.officialName ?? "",
        header: t("columnOfficialName"),
        meta: { label: t("columnOfficialName"), className: "whitespace-normal text-muted-foreground" },
      },
      {
        id: "status",
        // Sorted in the order the statuses read, not alphabetically.
        accessorFn: (tool) => GALLERY_STATUSES.indexOf(tool.status),
        header: t("columnStatus"),
        meta: { label: t("columnStatus"), className: "w-[15%]" },
        cell: ({ row }) => (
          <StatusGlyph tone={TOOL_STATUS_TONE[row.original.status]} label={t(`status.${TOOL_STATUS_KEY[row.original.status]}`)} />
        ),
      },
      {
        id: "category",
        accessorFn: (tool) => `${tool.category} ${tool.categorySub}`,
        header: t("columnCategory"),
        meta: { label: t("columnCategory"), className: "w-[15%] whitespace-normal" },
        cell: ({ row }) => (
          <span>
            {row.original.category}
            {row.original.categorySub && row.original.categorySub !== row.original.category ? (
              <span className="text-muted-foreground"> · {row.original.categorySub}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "location",
        accessorFn: (tool) => `${tool.location} ${tool.zone}`,
        header: t("columnLocation"),
        meta: { label: t("columnLocation"), className: "w-[15%] whitespace-normal" },
        cell: ({ row }) => (
          <span>
            {row.original.location}
            {row.original.zone ? <span className="text-muted-foreground"> · {row.original.zone}</span> : null}
          </span>
        ),
      },
      {
        id: "materials",
        accessorFn: (tool) => tool.materials.join(", "),
        header: t("columnMaterials"),
        meta: { label: t("columnMaterials"), className: "whitespace-normal" },
      },
      {
        id: "training",
        accessorFn: (tool) => ["Beginner", "Intermediate", "Advanced"].indexOf(tool.trainingLevel),
        header: t("columnTraining"),
        meta: { label: t("columnTraining"), className: "w-[11%]" },
        cell: ({ row }) => t(`training${row.original.trainingLevel}`),
      },
      {
        id: "available",
        accessorFn: (tool) => availableUnits(tool),
        header: t("columnAvailable"),
        sortDescFirst: true,
        meta: { label: t("columnAvailable"), align: "right", className: "w-[9%]" },
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
}

export function GalleryTable({
  tools,
  columns,
  visibility,
  label,
  stickyHeader,
  keyboardHint,
}: {
  tools: MakerLabTool[];
  columns: ColumnDef<MakerLabTool, unknown>[];
  visibility: VisibilityState;
  /** The table's name: the gallery's, or its section's when grouped. */
  label?: string;
  /** Off under a group's own sticky heading. */
  stickyHeader?: boolean;
  /** Said once, not under every group's table. */
  keyboardHint?: boolean;
}) {
  const t = useTranslations("gallery");
  const router = useRouter();

  return (
    <DataTable
      data={tools}
      columns={columns}
      getRowId={getRowId}
      getRowName={getRowName}
      labels={{ table: label ?? t("toolGalleryLabel") }}
      columnVisibility={visibility}
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
          <span className="ms-auto font-mono text-xs text-muted-foreground tabular-nums">
            {availableUnits(tool)}/{tool.units.length}
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
