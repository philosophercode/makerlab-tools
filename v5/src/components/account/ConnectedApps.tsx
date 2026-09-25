"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ConnectedAppRow } from "../../lib/account/token-rows";
import type { AccountActionError, RevokeResult } from "../../lib/account/token-actions";
import "../../styles/account.css";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { RevokeControl } from "./RevokeControl";

/**
 * "Connected apps" on `/account/tokens` (MCP access spec §3.4, §6): the OAuth
 * clients — claude.ai, ChatGPT — a person signed in to MakerLab from, each
 * revocable the same way a token is. Revoking deletes that client's access and
 * refresh tokens for this person; the next call it makes is a 401.
 */
export function ConnectedApps({
  initialApps,
  revokeAction,
}: {
  initialApps: ConnectedAppRow[];
  revokeAction: (clientId: string) => Promise<RevokeResult>;
}) {
  const t = useTranslations("account.apps");
  const tTokens = useTranslations("account.tokens");
  const format = useFormatter();
  const [apps, setApps] = useState(initialApps);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountActionError | null>(null);
  const [warning, setWarning] = useState(false);

  async function revoke(clientId: string) {
    setBusy(true);
    setError(null);
    setWarning(false);
    try {
      const result = await revokeAction(clientId);
      if (!result.ok && result.error !== "not_found") {
        setError(result.error);
        return;
      }
      setApps((current) => current.filter((app) => app.clientId !== clientId));
      if (result.ok && result.warning) setWarning(true);
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const nameOf = (app: ConnectedAppRow) => app.name || t("unnamed");

  function revokeFor(app: ConnectedAppRow) {
    const name = nameOf(app);
    return (
      <RevokeControl
        name={name}
        confirmText={t("revokeConfirm", { name })}
        confirming={confirming === app.clientId}
        busy={busy}
        onAsk={() => setConfirming(app.clientId)}
        onConfirm={() => void revoke(app.clientId)}
        onCancel={() => setConfirming(null)}
      />
    );
  }

  const columns: ColumnDef<ConnectedAppRow, unknown>[] = [
    {
      id: "name",
      accessorFn: nameOf,
      header: t("columnName"),
      meta: { rowHeader: true, className: "min-w-40 font-medium whitespace-normal" },
    },
    {
      id: "access",
      accessorFn: (app) => (app.readOnly ? 0 : 1),
      header: tTokens("columnAccess"),
      cell: ({ row }) => <Badge>{row.original.readOnly ? tTokens("readOnlyTag") : tTokens("fullAccessTag")}</Badge>,
    },
    {
      id: "lastSignIn",
      accessorFn: (app) => app.lastIssuedAt,
      header: t("columnLastSignIn"),
      meta: { align: "right" },
      cell: ({ row }) => row.original.lastIssuedAt.slice(0, 10),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{tTokens("revoke")}</span>,
      enableSorting: false,
      meta: { className: "text-end" },
      cell: ({ row }) => revokeFor(row.original),
    },
  ];

  return (
    <section className="account-section" aria-labelledby="connected-apps-heading">
      <h2 id="connected-apps-heading">{t("heading")}</h2>
      <p>{t("lede")}</p>
      <p className={`account-status${error ? " is-error" : warning ? " is-warning" : ""}`} role="status">
        {error ? tTokens(`errors.${error}`) : warning ? tTokens("warnings.audit_unavailable") : ""}
      </p>
      <DataTable
        data={apps}
        columns={columns}
        getRowId={(app) => app.clientId}
        getRowName={nameOf}
        labels={{ table: t("heading") }}
        empty={<EmptyState>{t("empty")}</EmptyState>}
        keyboardHint={false}
          stickyHeader={false}
        mobileRow={(app) => (
          <div className="flex flex-col gap-1 px-1 py-2.5">
            <div className="flex flex-wrap items-baseline gap-2">
              <strong className="text-sm">{nameOf(app)}</strong>
              {app.readOnly ? <Badge>{tTokens("readOnlyTag")}</Badge> : null}
            </div>
            <div className="text-xs text-muted-foreground">
              {t("lastSignIn", { date: format.dateTime(new Date(app.lastIssuedAt), { dateStyle: "medium" }) })}
            </div>
            <div className="flex justify-end">{revokeFor(app)}</div>
          </div>
        )}
      />
    </section>
  );
}
