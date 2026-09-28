"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "./catalog-types";
import { StatusGlyph } from "./system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "./ToolCard";
import { ToolImage } from "./ToolImage";
import { GALLERY_STATUSES, availableUnits } from "./gallery-filters";

/**
 * The gallery table's columns and the ones hidden by default — split from
 * `GalleryTable` so `GalleryShell` can build its Columns menu without loading
 * the table itself (TanStack Table, `DataTable`), which only the table view
 * needs and which it therefore loads on demand.
 */

/** Hidden until asked for: useful, but not what somebody scanning the lab needs. */
export const GALLERY_DEFAULT_HIDDEN: VisibilityState = { officialName: false, materials: false };

export function useGalleryColumns(): ColumnDef<GalleryTool, unknown>[] {
  const t = useTranslations("gallery");
  return useMemo<ColumnDef<GalleryTool, unknown>[]>(
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

/** 24px, contained: a product shot, not a crop. Decorative — the name is beside it. */
export function Thumb({ tool }: { tool: GalleryTool }) {
  return <ToolImage src={tool.imageSrc} thumbnails={tool.thumbnails} name={tool.name} sizes="24px" className="size-6 shrink-0 border border-border bg-card text-[8px]" />;
}
