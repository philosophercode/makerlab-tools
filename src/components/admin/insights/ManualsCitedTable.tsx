"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { ManualInsight } from "../../../lib/usage/queries";
import { DataTable } from "../../system/data-table/DataTable";
import { EmptyState } from "../../system/EmptyState";

/**
 * **Manuals cited** (usage insight spec §6): each manual the assistant's
 * answers linked to, its tool, how many citations, and the three pages cited
 * most — which is where a manual is earning its keep, or where a question
 * keeps landing.
 */
export function ManualsCitedTable({ manuals }: { manuals: ManualInsight[] }) {
  const t = useTranslations("admin.insights.manuals");

  const pages = (row: ManualInsight) => row.topPages.map((p) => t("page", { page: p.page, count: p.count })).join(" · ");

  const columns = useMemo<ColumnDef<ManualInsight, unknown>[]>(
    () => [
      {
        id: "manual",
        accessorFn: (row) => row.title ?? "",
        header: t("columnManual"),
        sortingFn: "text",
        meta: { rowHeader: true, className: "min-w-48 whitespace-normal" },
        cell: ({ row }) => <span className="font-medium">{row.original.title ?? t("deleted")}</span>,
      },
      {
        id: "tool",
        accessorFn: (row) => row.toolName ?? "",
        header: t("columnTool"),
        sortingFn: "text",
        meta: { className: "whitespace-normal" },
        cell: ({ row }) =>
          row.original.toolSlug ? (
            <Link href={`/tools/${row.original.toolSlug}`} className="hover:text-primary-ink hover:underline">
              {row.original.toolName}
            </Link>
          ) : (
            <span className="text-muted-foreground">–</span>
          ),
      },
      {
        id: "citations",
        accessorFn: (row) => row.citations,
        header: t("columnCitations"),
        sortDescFirst: true,
        meta: { align: "right" },
      },
      {
        id: "pages",
        accessorFn: (row) => pages(row),
        header: t("columnPages"),
        enableSorting: false,
        meta: { className: "whitespace-normal" },
        cell: ({ row }) => <span className="font-mono text-xs tabular-nums">{pages(row.original)}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  return (
    <DataTable
      data={manuals}
      columns={columns}
      getRowId={(row) => row.documentId ?? "deleted"}
      getRowName={(row) => row.title ?? t("deleted")}
      labels={{ table: t("tableLabel") }}
      keyboardHint={false}
      initialSorting={[{ id: "citations", desc: true }]}
      empty={<EmptyState>{t("empty")}</EmptyState>}
      mobileRow={(row) => (
        <div className="flex flex-col gap-0.5 px-1 py-2">
          <span className="text-sm font-medium">{row.title ?? t("deleted")}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {row.toolName ?? "–"} · {row.citations} · {pages(row)}
          </span>
        </div>
      )}
    />
  );
}
