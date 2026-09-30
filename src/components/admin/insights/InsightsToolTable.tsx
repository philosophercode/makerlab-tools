"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { QuietTool, ToolInsight } from "../../../lib/usage/queries";
import { DataTable } from "../../system/data-table/DataTable";
import { EmptyState } from "../../system/EmptyState";
import { cn } from "@/lib/utils";

/**
 * **Most asked about** and **Never asked about** (usage insight spec §6), on
 * the shared `DataTable`: each tool with how often it was asked about (in the
 * app and over MCP), its page views, QR scans, manual citations and
 * unanswered questions — sortable, each tool linking to its page. The second
 * view is the published tools nobody asked about or viewed in the period.
 */

type View = "asked" | "quiet";

const count = (value: number) => <span className={value === 0 ? "text-muted-foreground" : undefined}>{value}</span>;

export function InsightsToolTable({ tools, quiet }: { tools: ToolInsight[]; quiet: QuietTool[] }) {
  const t = useTranslations("admin.insights.tools");
  const [view, setView] = useState<View>("asked");

  const toolName = (row: Pick<ToolInsight, "toolId" | "name">) => row.name ?? (row.toolId ? t("deletedTool") : t("noTool"));

  const columns = useMemo<ColumnDef<ToolInsight, unknown>[]>(
    () => [
      {
        id: "tool",
        accessorFn: (row) => row.name ?? "",
        header: t("columnTool"),
        sortingFn: "text",
        meta: { rowHeader: true, className: "min-w-48 whitespace-normal" },
        cell: ({ row }) =>
          row.original.slug ? (
            <Link href={`/tools/${row.original.slug}`} className="font-medium hover:text-primary-ink hover:underline">
              {row.original.name}
            </Link>
          ) : (
            <span className="text-muted-foreground">{toolName(row.original)}</span>
          ),
      },
      ...(
        [
          ["asked", "columnAsked", (r: ToolInsight) => r.asked],
          ["askedChat", "columnChat", (r: ToolInsight) => r.askedChat],
          ["askedMcp", "columnMcp", (r: ToolInsight) => r.askedMcp],
          ["views", "columnViews", (r: ToolInsight) => r.views],
          ["qr", "columnQr", (r: ToolInsight) => r.qr],
          ["citations", "columnCitations", (r: ToolInsight) => r.citations],
          ["gaps", "columnGaps", (r: ToolInsight) => r.gaps],
        ] as const
      ).map(
        ([id, label, get]): ColumnDef<ToolInsight, unknown> => ({
          id,
          accessorFn: get,
          header: t(label),
          sortDescFirst: true,
          meta: { align: "right" },
          cell: ({ row }) => count(get(row.original)),
        })
      ),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t]
  );

  const quietColumns = useMemo<ColumnDef<QuietTool, unknown>[]>(
    () => [
      {
        id: "tool",
        accessorFn: (row) => row.name,
        header: t("columnTool"),
        sortingFn: "text",
        meta: { rowHeader: true, className: "whitespace-normal" },
        cell: ({ row }) => (
          <Link href={`/tools/${row.original.slug}`} className="hover:text-primary-ink hover:underline">
            {row.original.name}
          </Link>
        ),
      },
    ],
    [t]
  );

  return (
    <div data-slot="insights-tools" className="flex flex-col gap-3">
      <div role="group" aria-label={t("tabsLabel")} className="ui inline-flex self-start">
        {(
          [
            ["asked", t("mostAsked"), tools.length],
            ["quiet", t("neverAsked"), quiet.length],
          ] as const
        ).map(([value, label, n], i) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            onClick={() => setView(value)}
            className={cn(
              "inline-flex h-8 items-center gap-2 border border-outline-strong px-3 font-mono text-label tracking-[0.08em] uppercase",
              i > 0 && "-ms-px",
              view === value ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
            <span className="tabular-nums">{n}</span>
          </button>
        ))}
      </div>
      {view === "asked" ? (
        <DataTable
          data={tools}
          columns={columns}
          getRowId={(row) => row.toolId ?? "none"}
          getRowName={(row) => toolName(row)}
          labels={{ table: t("tableLabel") }}
          keyboardHint={false}
          initialSorting={[{ id: "asked", desc: true }]}
          empty={<EmptyState>{t("empty")}</EmptyState>}
          mobileRow={(row) => (
            <div className="flex flex-col gap-0.5 px-1 py-2">
              {row.slug ? (
                <Link href={`/tools/${row.slug}`} className="text-sm font-medium">
                  {row.name}
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">{toolName(row)}</span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">{t("mobileCounts", { asked: row.asked, views: row.views, qr: row.qr })}</span>
            </div>
          )}
        />
      ) : (
        <DataTable
          data={quiet}
          columns={quietColumns}
          getRowId={(row) => row.toolId}
          getRowName={(row) => row.name}
          labels={{ table: t("quietLabel") }}
          keyboardHint={false}
          empty={<EmptyState>{t("quietEmpty")}</EmptyState>}
        />
      )}
    </div>
  );
}
