"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { ImportStatus } from "../../lib/db/schema/vocabulary";
import { importPath, type ImportView } from "../../lib/import/view";
import { Button } from "@/components/ui/button";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";

/**
 * The "Imports" section of `/admin/intake` (bulk intake spec §6): an **Import
 * a list** button beside the queue, and the recent imports as a `DataTable` —
 * where each came from, where it is, how many items and possible duplicates it
 * made — so a half-reviewed import waits here to be picked up again (§2
 * "Imports are resumable"). A list that could not be read says so; it is
 * never shown as "no imports" (Article 4).
 */

/** Ready and mapping wait on a person; reading is the machine's turn. */
const STATUS_TONE: Record<ImportStatus, StatusTone> = {
  mapping: "active",
  parsing: "idle",
  ready: "active",
  failed: "bad",
};

export function ImportsList({ imports, canImport }: { imports: ImportView[] | null; canImport: boolean }) {
  const t = useTranslations("admin.import");
  const router = useRouter();

  const columns = useMemo<ColumnDef<ImportView, unknown>[]>(
    () => [
      {
        id: "source",
        accessorFn: (row) => row.sourceName ?? t(`source.${row.sourceKind}`),
        header: t("columnSource"),
        meta: { rowHeader: true, className: "whitespace-normal" },
        cell: ({ row, getValue }) => (
          <Link href={importPath(row.original.id)} className="font-medium hover:text-primary-ink hover:underline">
            {getValue() as string}
          </Link>
        ),
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: t("columnStatus"),
        cell: ({ row }) => <StatusGlyph tone={STATUS_TONE[row.original.status]} label={t(`status.${row.original.status}`)} />,
      },
      {
        id: "items",
        accessorFn: (row) => row.itemCount,
        header: t("columnItems"),
        sortDescFirst: true,
        meta: { align: "right" },
        cell: ({ row }) => <Count value={row.original.status === "ready" ? row.original.itemCount : null} />,
      },
      {
        id: "duplicates",
        accessorFn: (row) => row.duplicateCount,
        header: t("columnDuplicates"),
        sortDescFirst: true,
        meta: { align: "right" },
        cell: ({ row }) => <Count value={row.original.status === "ready" ? row.original.duplicateCount : null} warn />,
      },
      {
        id: "by",
        accessorFn: (row) => row.createdByName ?? "",
        header: t("columnBy"),
        cell: ({ row }) => row.original.createdByName ?? <span className="text-muted-foreground">–</span>,
      },
      {
        id: "created",
        accessorFn: (row) => row.createdAt,
        header: t("columnCreated"),
        meta: { align: "right" },
        cell: ({ row }) => row.original.createdAt.slice(0, 10),
      },
    ],
    [t]
  );

  return (
    <section className="ui my-8 flex flex-col gap-3" aria-labelledby="imports-title">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="imports-title" className="font-heading text-lg font-medium uppercase">
          {t("sectionTitle")}
        </h3>
        {canImport ? (
          <Button asChild variant="default">
            <Link href="/admin/intake/imports/new">{t("importButton")}</Link>
          </Button>
        ) : null}
      </header>
      {imports === null ? (
        <p className="text-sm text-bad" role="alert">
          {t("sectionUnavailable")}
        </p>
      ) : (
        <DataTable
          data={imports}
          columns={columns}
          getRowId={getRowId}
          getRowName={(row) => row.sourceName ?? t(`source.${row.sourceKind}`)}
          labels={{ table: t("listLabel") }}
          empty={<EmptyState>{t("sectionEmpty")}</EmptyState>}
          onActivate={(row) => router.push(importPath(row.id))}
          mobileRow={(row) => (
            <div className="flex flex-col gap-0.5 px-1 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <Link href={importPath(row.id)} className="truncate text-sm font-medium">
                  {row.sourceName ?? t(`source.${row.sourceKind}`)}
                </Link>
                <StatusGlyph tone={STATUS_TONE[row.status]} label={t(`status.${row.status}`)} compact />
              </div>
              <p className="text-xs text-muted-foreground">
                {[
                  row.status === "ready" ? t("listCounts", { items: row.itemCount, duplicates: row.duplicateCount }) : t(`status.${row.status}`),
                  row.createdByName,
                  row.createdAt.slice(0, 10),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          )}
        />
      )}
    </section>
  );
}

const getRowId = (row: ImportView) => row.id;

/** A count, or a dash while the import has not been read into rows yet. */
function Count({ value, warn = false }: { value: number | null; warn?: boolean }) {
  if (value === null) return <span className="text-muted-foreground">–</span>;
  if (value === 0) return <span className="text-muted-foreground">0</span>;
  return <span className={warn ? "text-warn" : undefined}>{value}</span>;
}
