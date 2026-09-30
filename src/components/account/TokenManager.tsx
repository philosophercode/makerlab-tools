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
import { TOKEN_LIFETIME_DAYS } from "../../lib/account/token-lifetime";
import { AiSetupPrompt } from "./AiSetupPrompt";
import { CopyableCode } from "./CopyableCode";
import { RevokeControl } from "./RevokeControl";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RowStatus } from "../admin/RowStatus";
import { DataTable } from "../system/data-table/DataTable";
import { EmptyState } from "../system/EmptyState";
import { Field, hintId } from "../system/Field";
import { PageSection, SectionLabel } from "../system/PublicPage";
import { Glyph, StatusGlyph, type StatusTone } from "../system/StatusGlyph";

/**
 * Personal access tokens on `/account/tokens` (MCP access spec §5.1, §6; the
 * 2026-09-25 amendment): the create form, the one-time reveal, and the list
 * with an inline-confirmed Revoke.
 *
 * The actions arrive as props (the `RoleSelect` idiom): the page is a server
 * component that already has them, and importing `actions.ts` here would drag
 * `next/headers` and the limiter into a client graph.
 *
 * **One lifetime.** Every token expires in 90 days (one semester); the form
 * says the date as text and offers no choice. Read-only is the one option.
 *
 * **The token is shown once.** It lives in this component's state from the
 * create action's answer until "I've copied it" or the page is left, and is
 * never written anywhere else. The reveal says so above the token and again
 * beside the button that dismisses it. The form and the reveal share one
 * column, so neither juts out of the other.
 */

export interface TokenManagerProps {
  initialTokens: TokenRow[];
  /** The deployment's origin, for the snippets. */
  baseUrl: string;
  createAction: (input: { name: string; readOnly: boolean }) => Promise<CreateTokenResult>;
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
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [revealed, setRevealed] = useState<{ token: string; name: string; expiresAt: string | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  // "Now" as of mount: expiry is read in days, so a render-stable clock is plenty.
  const [now] = useState(() => Date.now());

  const snippets = mcpSnippets(baseUrl, revealed?.token);
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const expiresOnCreate = date(new Date(now + TOKEN_LIFETIME_DAYS * 86_400_000).toISOString());

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus({ kind: "idle" });
    try {
      const result = await createAction({ name, readOnly });
      if (!result.ok) {
        setStatus({ kind: "error", code: result.error });
        return;
      }
      const row = toTokenRow(result.summary);
      setTokens((current) => [row, ...current]);
      setRevealed({ token: result.token, name: result.summary.name, expiresAt: row.expiresAt });
      setName("");
      setReadOnly(false);
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
      const revokedAt = new Date().toISOString();
      setTokens((current) => current.map((row) => (row.id === tokenId ? { ...row, revokedAt: row.revokedAt ?? revokedAt } : row)));
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
    <div data-slot="token-manager" className="ui flex min-w-0 flex-col">
      {/* The form and the reveal share this one column. */}
      <div className="flex w-full max-w-[640px] min-w-0 flex-col gap-4">
        <PageSection id="new-token-heading" title={t("newHeading")}>
          <form className="flex w-full min-w-0 flex-col gap-4" onSubmit={handleCreate}>
            <Field id="token-name" label={t("name")} hint={t("nameHint")}>
              <Input
                id="token-name"
                type="text"
                value={name}
                maxLength={80}
                required
                placeholder={t("namePlaceholder")}
                aria-describedby={hintId("token-name")}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <div className="flex flex-col gap-1">
              <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t("expiry")}</span>
              <p data-testid="token-expiry" className="text-sm">
                {t("expiryFixed", { date: expiresOnCreate })}
              </p>
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
              <Button type="submit" variant={revealed ? "quiet" : "default"} disabled={busy || !name.trim()}>
                {busy ? t("creating") : t("create")}
              </Button>
            </div>
          </form>
        </PageSection>

        <RowStatus
          tone={status.kind === "error" ? "bad" : status.kind === "warning" ? "warn" : "muted"}
          className="text-sm"
        >
          {status.kind === "error" ? t(`errors.${status.code}`) : status.kind === "warning" ? t(`warnings.${status.code}`) : null}
        </RowStatus>
        {revealed ? (
          <section
            aria-labelledby="reveal-heading"
            data-slot="token-reveal"
            className="flex min-w-0 flex-col gap-3 border border-s-4 border-border border-s-warn bg-card p-4"
          >
            <h2 id="reveal-heading" className="font-heading text-lg font-medium uppercase">
              {t("revealHeading", { name: revealed.name })}
            </h2>
            <SaveWarning>{t("revealWarning")}</SaveWarning>
            {revealed.expiresAt ? (
              <p className="text-xs text-muted-foreground">{t("revealWarningDetail", { date: date(revealed.expiresAt) })}</p>
            ) : null}
            <CopyableCode label={t("tokenLabel")} value={revealed.token} />

            <SectionLabel>{t("setupHeading")}</SectionLabel>
            <p className="text-sm">{t("revealStepToken")}</p>
            <CopyableCode label={t("setupEnvLabel")} value={snippets.envExport} />
            <p className="text-sm">{t("revealStepClient")}</p>
            <p className="text-sm text-muted-foreground">{t("setupClaudeCode")}</p>
            <CopyableCode label={t("setupClaudeCode")} value={snippets.claudeCode} />
            <p className="text-sm text-muted-foreground">{t("setupClaudeDesktop")}</p>
            <CopyableCode label={t("setupClaudeDesktop")} value={snippets.claudeDesktop} />
            <p className="text-sm text-muted-foreground">{t("setupCodex")}</p>
            <CopyableCode label={t("setupCodex")} value={snippets.codexToml} />

            <AiSetupPrompt snippets={snippets} variant="token" headingId="reveal-ai-prompt-heading" />

            <div className="mt-2 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
              <SaveWarning>{t("revealWarning")}</SaveWarning>
              <Button variant="default" className="self-start sm:self-auto" onClick={() => setRevealed(null)}>
                {t("done")}
              </Button>
            </div>
          </section>
        ) : null}

      </div>

      <PageSection id="token-list-heading" title={t("listHeading")}>
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
      </PageSection>
    </div>
  );
}

/** "Save this token now…" — the warn glyph and the sentence, in ink, never colour alone. */
function SaveWarning({ children }: { children: React.ReactNode }) {
  return (
    <p data-slot="save-warning" className="flex items-baseline gap-2 text-sm font-semibold">
      <Glyph tone="warn" />
      <span>{children}</span>
    </p>
  );
}

const STATE_TONE: Record<"active" | "expired" | "revoked", StatusTone> = { active: "ok", expired: "warn", revoked: "muted" };

/** An ISO day for a table cell, or the word for "none" (a token from before one lifetime may never expire). */
function isoOr(iso: string | null, none: string) {
  return iso ? iso.slice(0, 10) : <span className="text-muted-foreground">{none}</span>;
}
