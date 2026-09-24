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

  return (
    <div className="account-tokens">
      <section className="account-section" aria-labelledby="new-token-heading">
        <h2 id="new-token-heading">{t("newHeading")}</h2>
        <form className="account-form" onSubmit={handleCreate}>
          <div className="account-field">
            <label htmlFor="token-name">{t("name")}</label>
            <input
              id="token-name"
              type="text"
              value={name}
              maxLength={80}
              required
              placeholder={t("namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="account-field-hint">{t("nameHint")}</p>
          </div>
          <div className="account-field">
            <label htmlFor="token-expiry">{t("expiry")}</label>
            <select id="token-expiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
              <option value="30">{t("expiry30")}</option>
              <option value="90">{t("expiry90")}</option>
              <option value="never">{t("expiryNever")}</option>
            </select>
          </div>
          <label className="account-check">
            <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
            <span>
              <strong>{t("readOnly")}</strong>
              <br />
              <span className="account-field-hint">{t("readOnlyHint")}</span>
            </span>
          </label>
          <div className="account-actions">
            <button type="submit" className="account-button is-primary" disabled={busy || !name.trim()}>
              {busy ? t("creating") : t("create")}
            </button>
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
            <button type="button" className="account-button" onClick={() => setRevealed(null)}>
              {t("done")}
            </button>
          </div>
        </section>
      ) : null}

      <section className="account-section" aria-labelledby="token-list-heading">
        <h2 id="token-list-heading">{t("listHeading")}</h2>
        {tokens.length === 0 ? (
          <p>{t("empty")}</p>
        ) : (
          <ul className="account-list">
            {tokens.map((row) => {
              const state = stateOf(row);
              return (
                <li key={row.id} className={`account-row${state === "active" ? "" : " is-inactive"}`}>
                  <div>
                    <p>
                      <strong>{row.name}</strong>
                      <span className="account-tag">{row.readOnly ? t("readOnlyTag") : t("fullAccessTag")}</span>
                      <span className="account-tag">{t(`status.${state}`)}</span>
                    </p>
                    <p className="account-row-meta">
                      <span className="account-prefix">mlt_{row.prefix}…</span>
                      {" · "}
                      {row.lastUsedAt ? t("lastUsed", { date: date(row.lastUsedAt) }) : t("neverUsed")}
                      {" · "}
                      {row.expiresAt ? t("expires", { date: date(row.expiresAt) }) : t("neverExpires")}
                    </p>
                  </div>
                  {state === "revoked" ? null : confirming === row.id ? (
                    <div className="account-actions" role="group" aria-label={t("revokeConfirm", { name: row.name })}>
                      <span>{t("revokeConfirm", { name: row.name })}</span>
                      <button type="button" className="account-button is-primary" disabled={busy} onClick={() => handleRevoke(row.id)}>
                        {t("revokeYes")}
                      </button>
                      <button type="button" className="account-button" disabled={busy} onClick={() => setConfirming(null)}>
                        {t("cancel")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="account-button"
                      disabled={busy}
                      aria-label={t("revokeAria", { name: row.name })}
                      onClick={() => setConfirming(row.id)}
                    >
                      {t("revoke")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
