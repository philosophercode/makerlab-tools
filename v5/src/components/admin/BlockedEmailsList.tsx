"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AdminActionError, UnblockEmailAction } from "../../app/admin/users/action-result";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { useHydrated } from "./use-hydrated";

/**
 * "Blocked emails" on `/admin/users` (auth spec amendment 2026-09-25): every
 * address a removal blocked from signing up again, why, who blocked it and
 * when, each with **Unblock**. Compact on purpose — a handful of rows, if any.
 *
 * Unblock saves on the click: the row leaves the list once the server says
 * so, and a refusal keeps it with the reason. The address can always be
 * blocked again by removing the account it goes on to make.
 */

export interface BlockedEmailRow {
  email: string;
  reason: string | null;
  blockedByName: string | null;
  /** ISO day, locale-neutral like the roster's dates. */
  blockedOn: string;
}

export interface BlockedEmailsListProps {
  rows: BlockedEmailRow[];
  unblock: UnblockEmailAction;
}

export function BlockedEmailsList({ rows, unblock }: BlockedEmailsListProps) {
  const t = useTranslations("admin.users.blocked");
  const tAdmin = useTranslations("admin");
  const hydrated = useHydrated();
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const visible = useMemo(() => rows.filter((row) => !gone.has(row.email)), [rows, gone]);

  const run = useCallback(
    async (email: string) => {
      setPending(email);
      setStatus(null);
      let error: AdminActionError = "failed";
      try {
        const result = await unblock({ email });
        if (result.ok) {
          setGone((current) => new Set(current).add(email));
          setStatus({ tone: "ok", text: t("unblocked", { email }) });
          return;
        }
        error = result.error;
      } catch {
        error = "failed";
      } finally {
        setPending(null);
      }
      setStatus({ tone: "bad", text: tAdmin(`errors.${error}`) });
    },
    [unblock, t, tAdmin]
  );

  const button = useCallback(
    (email: string) => (
      <Button
        type="button"
        size="xs"
        disabled={!hydrated || pending !== null}
        aria-label={t("unblockFor", { email })}
        onClick={() => void run(email)}
      >
        {pending === email ? t("unblocking") : t("unblock")}
      </Button>
    ),
    [hydrated, pending, run, t]
  );

  const columns = useMemo<ColumnDef<BlockedEmailRow, unknown>[]>(
    () => [
      {
        id: "email",
        accessorFn: (row) => row.email,
        header: t("columnEmail"),
        enableHiding: false,
        meta: { rowHeader: true },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.email}</span>,
      },
      {
        id: "reason",
        accessorFn: (row) => row.reason ?? "",
        header: t("columnReason"),
        meta: { className: "whitespace-normal" },
        cell: ({ row }) => row.original.reason ?? <span className="text-muted-foreground">–</span>,
      },
      {
        id: "by",
        accessorFn: (row) => row.blockedByName ?? "",
        header: t("columnBy"),
        cell: ({ row }) => row.original.blockedByName ?? <span className="text-muted-foreground">–</span>,
      },
      {
        id: "on",
        accessorFn: (row) => row.blockedOn,
        header: t("columnOn"),
        meta: { align: "right" },
      },
      {
        id: "unblock",
        header: () => <span className="sr-only">{t("unblock")}</span>,
        enableSorting: false,
        enableHiding: false,
        meta: { align: "right" },
        cell: ({ row }) => button(row.original.email),
      },
    ],
    [t, button]
  );

  return (
    <section className="flex flex-col gap-2" aria-labelledby="blocked-emails-heading">
      <h2 id="blocked-emails-heading" className="font-heading text-lg font-medium uppercase">
        {t("heading")}
      </h2>
      <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">{t("lede")}</p>
      <p
        role="status"
        className={cn("m-0 text-xs empty:hidden", status?.tone === "bad" ? "text-bad" : "text-muted-foreground")}
      >
        {status?.text ?? null}
      </p>
      <DataTable
        data={visible}
        columns={columns}
        getRowId={getRowId}
        getRowName={getRowId}
        labels={{ table: t("tableLabel") }}
        keyboardHint={false}
        empty={<EmptyState>{t("empty")}</EmptyState>}
        mobileRow={(row) => (
          <div className="flex items-start justify-between gap-3 px-1 py-2.5">
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-xs">{row.email}</span>
              <span className="text-xs text-muted-foreground">
                {[row.reason, row.blockedByName, row.blockedOn].filter(Boolean).join(" · ")}
              </span>
            </span>
            {button(row.email)}
          </div>
        )}
      />
    </section>
  );
}

const getRowId = (row: BlockedEmailRow) => row.email;
