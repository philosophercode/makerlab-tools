"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import type { DemoSignupRole } from "../../lib/db/schema/vocabulary";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";

/**
 * People → Demo sign-ups (demo pass spec 2026-10-07 §5.6): one row per
 * visitor who signed up for a demo pass — their answers, whether they may be
 * contacted, and what the pass has spent. Read-only: there is nothing to do to
 * a sign-up here but read it and download the CSV. Dates are ISO days, the
 * same on the server and the client.
 */

export interface DemoSignupRow {
  id: string;
  name: string;
  email: string;
  institution: string;
  role: DemoSignupRole | null;
  runsMakerspace: boolean | null;
  useCase: string | null;
  consentToContact: boolean;
  passActive: boolean;
  /** ISO day. */
  passEndsOn: string;
  spentUsd: number;
  chargedTurns: number;
  /** ISO day. */
  signedUpOn: string;
}

const dash = <span className="text-muted-foreground">–</span>;

export function DemoSignupsTable({ rows, budgetUsd }: { rows: DemoSignupRow[]; budgetUsd: number }) {
  const t = useTranslations("admin.demoSignups");
  const money = (value: number) => `$${value.toFixed(2)}`;
  const spent = (row: DemoSignupRow) => t("spentOf", { spent: money(row.spentUsd), budget: money(budgetUsd) });
  const yesNo = (value: boolean | null) => (value === null ? dash : value ? t("yes") : t("no"));

  const columns = useMemo<ColumnDef<DemoSignupRow, unknown>[]>(
    () => [
      { id: "signedUp", accessorFn: (row) => row.signedUpOn, header: t("columnSignedUp"), cell: ({ row }) => <span className="tabular-nums">{row.original.signedUpOn}</span> },
      {
        // The person and their address together, as on the People roster.
        id: "name",
        accessorFn: (row) => `${row.name} ${row.email}`,
        header: t("columnName"),
        enableHiding: false,
        meta: { rowHeader: true },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span>{row.original.name}</span>
            <a className="font-mono text-xs text-primary-ink hover:underline" href={`mailto:${row.original.email}`}>
              {row.original.email}
            </a>
          </span>
        ),
      },
      { id: "institution", accessorFn: (row) => row.institution, header: t("columnInstitution"), meta: { className: "whitespace-normal" } },
      { id: "role", accessorFn: (row) => row.role ?? "", header: t("columnRole"), cell: ({ row }) => (row.original.role ? t(`role.${row.original.role}`) : dash) },
      { id: "makerspace", accessorFn: (row) => String(row.runsMakerspace), header: t("columnMakerspace"), cell: ({ row }) => yesNo(row.original.runsMakerspace) },
      {
        id: "useCase",
        accessorFn: (row) => row.useCase ?? "",
        header: t("columnUseCase"),
        meta: { className: "min-w-48 whitespace-normal" },
        cell: ({ row }) => (row.original.useCase ? <span className="whitespace-pre-wrap">{row.original.useCase}</span> : dash),
      },
      { id: "consent", accessorFn: (row) => String(row.consentToContact), header: t("columnConsent"), cell: ({ row }) => yesNo(row.original.consentToContact) },
      {
        id: "pass",
        accessorFn: (row) => row.passEndsOn,
        header: t("columnPass"),
        cell: ({ row }) => (row.original.passActive ? t("passActive", { date: row.original.passEndsOn }) : t("passEnded")),
      },
      {
        id: "spent",
        accessorFn: (row) => row.spentUsd,
        header: t("columnSpent"),
        meta: { align: "right" },
        // The spend and, under it, how many chat turns made it (the CSV has both as columns).
        cell: ({ row }) => (
          <span className="flex flex-col items-end tabular-nums">
            <span>{spent(row.original)}</span>
            <span className="text-xs text-muted-foreground">{t("turns", { count: row.original.chargedTurns })}</span>
          </span>
        ),
      },
    ],
    // `spent` and `yesNo` close over `t` and `budgetUsd` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, budgetUsd]
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={getRowId}
      getRowName={getRowName}
      labels={{ table: t("tableLabel") }}
      keyboardHint={false}
      empty={<EmptyState>{t("empty")}</EmptyState>}
      initialSorting={[{ id: "signedUp", desc: true }]}
      mobileRow={(row) => (
        <div className="flex flex-col gap-0.5 px-1 py-2.5 text-sm">
          <span className="font-medium">{row.name}</span>
          <a className="w-fit font-mono text-xs text-primary-ink" href={`mailto:${row.email}`}>
            {row.email}
          </a>
          <span className="text-xs text-muted-foreground">
            {[row.institution, row.role ? t(`role.${row.role}`) : null, row.consentToContact ? t("mayContact") : null, spent(row)].filter(Boolean).join(" · ")}
          </span>
        </div>
      )}
    />
  );
}

const getRowId = (row: DemoSignupRow) => row.id;
const getRowName = (row: DemoSignupRow) => row.name;
