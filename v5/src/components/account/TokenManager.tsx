"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { mcpSnippets } from "../../lib/account/mcp-snippets";
import { toTokenRow, type TokenRow } from "../../lib/account/token-rows";
import type {
  AccountActionError,
  AccountActionWarning,
  CreateTokenResult,
  RevokeResult,
} from "../../lib/account/token-actions";
import { CopyableCode } from "./CopyableCode";
import { RevokeControl } from "./RevokeControl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { StatusGlyph, type StatusTone } from "../system/StatusGlyph";
import "../../styles/account.css";

/**
 * Personal access tokens on `/account/tokens` (MCP access spec §5.1, §6): the
 * create form, the one-time reveal, and the list with an inline-confirmed
 * Revoke.
 *
 * The actions arrive as props (the `RoleSelect` idiom): the page is a server
 * component that already has them, and importing `actions.ts` here would drag
 * `next/headers` and the limiter into a client graph.
 *
 * **The token is shown once.** It lives in this component's state from the
 * create action's answer until "I've copied it" or the page is left, and is
 * never written anywhere else. Hiding a control is presentation; every action
 * checks the session again on the server.
 */

export interface TokenManagerProps {
  initialTokens: TokenRow[];
  /** The deployment's origin, for the snippets. */
  baseUrl: string;
  createAction: (input: { name: string; expiry: string; readOnly: boolean }) => Promise<CreateTokenResult>;
  revokeAction: (tokenId: string) => Promise<RevokeResult>;
}

type Status =
  | { kind: "idle" }
  | { kind: "error"; code: AccountActionError }
  | { kind: "warning"; code: AccountActionWarning };

export function TokenManager({ initialTokens, baseUrl, createAction, revokeAction }: TokenManagerProps) {
  const t = useTranslations("account.tokens");
  const format = useFormatter();
  const [tokens, setTokens] = useState<TokenRow[]>(initialTokens);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [revealed, setRevealed] = useState<{ token: string; name: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // "Now" as of mount: expiry is read in days, so a render-stable clock is plenty.
  const [now] = useState(() => Date.now());

  const snippets = mcpSnippets(baseUrl, revealed?.token);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const result = await createAction({ name, expiry, readOnly });
      if (!result.ok) {
        setStatus({ kind: "error", code: result.error });
        return;
      }
      setTokens((current) => [toTokenRow(result.summary), ...current]);
      setRevealed({ token: result.token, name: result.summary.name });
      setName("");
      setReadOnly(false);
      setExpiry("90");
      if (result.warning) setStatus({ kind: "warning", code: result.warning });
    } catch {
      setStatus({ kind: "error", code: "failed" });
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const result = await revokeAction(tokenId);
      if (!result.ok && result.error !== "already_revoked") {
        setStatus({ kind: "error", code: result.error });
        return;
      }
      const now = new Date().toISOString();
      setTokens((current) => current.map((row) => (row.id === tokenId ? { ...row, revokedAt: row.revokedAt ?? now } : row)));
      if (result.ok && result.warning) setStatus({ kind: "warning", code: result.warning });
    } catch {
      setStatus({ kind: "error", code: "failed" });
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  function stateOf(row: TokenRow): "active" | "expired" | "revoked" {
    if (row.revokedAt) return "revoked";
    if (row.expiresAt && new Date(row.expiresAt).getTime() <= now) return "expired";
    return "active";
  }

  const columns: ColumnDef<TokenRow, unknown>[] = [
    {
      id: "name",
      accessorFn: (row) => row.name,
      header: t("name"),
      meta: { rowHeader: true, className: "min-w-40 font-medium whitespace-normal" },
    },
    {
      id: "access",
      accessorFn: (row) => (row.readOnly ? 0 : 1),
      header: t("columnAccess"),
      cell: ({ row }) => <Badge>{row.original.readOnly ? t("readOnlyTag") : t("fullAccessTag")}</Badge>,
    },
    {
      id: "status",
      accessorFn: (row) => stateOf(row),
      header: t("columnStatus"),
      cell: ({ row }) => {
        const state = stateOf(row.original);
        return <StatusGlyph tone={STATE_TONE[state]} label={t(`status.${state}`)} />;
      },
    },
    {
      id: "prefix",
      header: t("columnPrefix"),
      enableSorting: false,
      cell: ({ row }) => <span className="font-mono text-xs">mlt_{row.original.prefix}…</span>,
    },
    {
      id: "lastUsed",
      accessorFn: (row) => row.lastUsedAt ?? "",
      header: t("columnLastUsed"),
      meta: { align: "right" },
      cell: ({ row }) => isoOr(row.original.lastUsedAt, t("never")),
    },
    {
      id: "expires",
      accessorFn: (row) => row.expiresAt ?? "9999",
      header: t("expiry"),
      meta: { align: "right" },
      cell: ({ row }) => isoOr(row.original.expiresAt, t("never")),
    },
    {
      id: "actions",
      header: () => <span className="sr-only">{t("revoke")}</span>,
      enableSorting: false,
      meta: { className: "text-end" },
      cell: ({ row }) => revokeFor(row.original),
    },
  ];

  function revokeFor(row: TokenRow) {
    if (stateOf(row) === "revoked") return null;
    return (
      <RevokeControl
        name={row.name}
        confirmText={t("revokeConfirm", { name: row.name })}
        confirming={confirming === row.id}
        busy={busy}
        onAsk={() => setConfirming(row.id)}
        onConfirm={() => void handleRevoke(row.id)}
        onCancel={() => setConfirming(null)}
      />
    );
  }

  return (
    <div className="account-tokens">
      <section className="account-section" aria-labelledby="new-token-heading">
        <h2 id="new-token-heading">{t("newHeading")}</h2>
        <form className="ui flex max-w-[560px] flex-col gap-4" onSubmit={handleCreate}>
          <div className="flex flex-col gap-1">
            <label htmlFor="token-name" className={LABEL}>
              {t("name")}
            </label>
            <Input
              id="token-name"
              type="text"
              value={name}
              maxLength={80}
              required
              placeholder={t("namePlaceholder")}
              aria-describedby="token-name-hint"
              onChange={(event) => setName(event.target.value)}
            />
            <span id="token-name-hint" className="text-xs text-muted-foreground">
              {t("nameHint")}
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="token-expiry" className={LABEL}>
              {t("expiry")}
            </label>
            <NativeSelect id="token-expiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
              <option value="30">{t("expiry30")}</option>
              <option value="90">{t("expiry90")}</option>
              <option value="never">{t("expiryNever")}</option>
            </NativeSelect>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="token-read-only"
              className="mt-0.5"
              checked={readOnly}
              aria-describedby="token-read-only-hint"
              onCheckedChange={(value) => setReadOnly(value === true)}
            />
            <label htmlFor="token-read-only" className="flex flex-col text-sm">
              <strong>{t("readOnly")}</strong>
              <span id="token-read-only-hint" className="text-xs text-muted-foreground">
                {t("readOnlyHint")}
              </span>
            </label>
          </div>
          <div>
            <Button type="submit" variant="default" disabled={busy || !name.trim()}>
              {busy ? t("creating") : t("create")}
            </Button>
          </div>
        </form>
      </section>

      <p className={`account-status${status.kind === "error" ? " is-error" : status.kind === "warning" ? " is-warning" : ""}`} role="status">
        {status.kind === "error" ? t(`errors.${status.code}`) : status.kind === "warning" ? t(`warnings.${status.code}`) : ""}
      </p>

      {revealed ? (
        <section className="account-reveal" aria-labelledby="reveal-heading">
          <h2 id="reveal-heading">{t("revealHeading", { name: revealed.name })}</h2>
          <p>
            <strong>{t("revealWarning")}</strong>
          </p>
          <CopyableCode label={t("tokenLabel")} value={revealed.token} />
          <h3>{t("setupHeading")}</h3>
          <p>{t("setupEnv")}</p>
          <CopyableCode label={t("setupEnvLabel")} value={snippets.envExport} />
          <p>{t("setupClaudeCode")}</p>
          <CopyableCode label={t("setupClaudeCode")} value={snippets.claudeCode} />
          <p>{t("setupClaudeDesktop")}</p>
          <CopyableCode label={t("setupClaudeDesktop")} value={snippets.claudeDesktop} />
          <p>{t("setupCodex")}</p>
          <CopyableCode label={t("setupCodex")} value={snippets.codexToml} />
          <div className="account-actions">
            <Button onClick={() => setRevealed(null)}>{t("done")}</Button>
          </div>
        </section>
      ) : null}

      <section className="account-section" aria-labelledby="token-list-heading">
        <h2 id="token-list-heading">{t("listHeading")}</h2>
        <DataTable
          data={tokens}
          columns={columns}
          getRowId={(row) => row.id}
          getRowName={(row) => row.name}
          labels={{ table: t("listHeading") }}
          empty={<EmptyState>{t("empty")}</EmptyState>}
          keyboardHint={false}
          stickyHeader={false}
          rowClassName={(row) => (stateOf(row) === "active" ? undefined : "text-muted-foreground")}
          mobileRow={(row) => {
            const state = stateOf(row);
            return (
              <div className="flex flex-col gap-1 px-1 py-2.5">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong className="text-sm">{row.name}</strong>
                  <Badge>{row.readOnly ? t("readOnlyTag") : t("fullAccessTag")}</Badge>
                  <StatusGlyph tone={STATE_TONE[state]} label={t(`status.${state}`)} />
                </div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">mlt_{row.prefix}…</span>
                  {" · "}
                  {row.lastUsedAt ? t("lastUsed", { date: date(row.lastUsedAt) }) : t("neverUsed")}
                  {" · "}
                  {row.expiresAt ? t("expires", { date: date(row.expiresAt) }) : t("neverExpires")}
                </div>
                <div className="flex justify-end">{revokeFor(row)}</div>
              </div>
            );
          }}
        />
      </section>
    </div>
  );
}

const LABEL = "font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase";

const STATE_TONE: Record<"active" | "expired" | "revoked", StatusTone> = { active: "ok", expired: "warn", revoked: "muted" };

/** An ISO day for a table cell, or the word for "none". */
function isoOr(iso: string | null, none: string) {
  return iso ? iso.slice(0, 10) : <span className="text-muted-foreground">{none}</span>;
}
