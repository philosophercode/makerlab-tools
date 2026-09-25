"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { MakerLabTool } from "./catalog-types";
import { DataTable } from "./system/data-table/DataTable";

/**
 * The gallery's table view (UI system spec §8.2) on the shared `DataTable`:
 * a real `<table>` with `aria-sort` on the header cell — the old view was a
 * div grid whose sort buttons carried `aria-sort`, which no screen reader
 * reads there. The rows arrive already filtered and ranked by `GalleryShell`;
 * with no column sorted they keep that order, and a header sorts on top of
 * it. Enter on a row opens the tool. On a phone each tool is a two-line item.
 */
export function GalleryTable({ tools }: { tools: MakerLabTool[] }) {
  const t = useTranslations("gallery");
  const router = useRouter();

  const columns = useMemo<ColumnDef<MakerLabTool, unknown>[]>(
    () => [
      {
        id: "name",
        accessorFn: (tool) => tool.name,
        header: t("columnTool"),
        meta: { rowHeader: true, className: "whitespace-normal" },
        cell: ({ row }) => (
          <span className="flex items-center gap-3">
            <Thumb tool={row.original} />
            <Link href={`/tools/${row.original.slug}`} className="font-medium hover:text-primary-ink hover:underline">
              {row.original.name}
            </Link>
          </span>
        ),
      },
      { id: "category", accessorFn: (tool) => tool.category ?? "", header: t("columnCategory") },
      { id: "zone", accessorFn: (tool) => tool.zone ?? "", header: t("columnZone") },
      { id: "training", accessorFn: (tool) => tool.trainingLevel ?? "", header: t("columnTraining") },
    ],
    [t]
  );

  return (
    <DataTable
      data={tools}
      columns={columns}
      getRowId={getRowId}
      getRowName={getRowName}
      labels={{ table: t("toolGalleryLabel") }}
      empty={null}
      onActivate={(tool) => router.push(`/tools/${tool.slug}`)}
      mobileRow={(tool) => (
        <Link href={`/tools/${tool.slug}`} className="flex items-center gap-3 px-1 py-2">
          <Thumb tool={tool} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{tool.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[tool.category, tool.zone, tool.trainingLevel].filter(Boolean).join(" · ")}
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
  return (
    <span aria-hidden="true" className="relative block size-6 shrink-0 overflow-hidden border border-border bg-card">
      <Image src={tool.imageSrc} alt="" fill sizes="24px" style={{ objectFit: "contain" }} unoptimized />
    </span>
  );
}
