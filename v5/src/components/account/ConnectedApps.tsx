"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { ConnectedAppRow } from "../../lib/account/token-rows";
import type { AccountActionError, RevokeResult } from "../../lib/account/token-actions";
import "../../styles/account.css";

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

  return (
    <section className="account-section" aria-labelledby="connected-apps-heading">
      <h2 id="connected-apps-heading">{t("heading")}</h2>
      <p>{t("lede")}</p>
      <p className={`account-status${error ? " is-error" : warning ? " is-warning" : ""}`} role="status">
        {error ? tTokens(`errors.${error}`) : warning ? tTokens("warnings.audit_unavailable") : ""}
      </p>
      {apps.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="account-list">
          {apps.map((app) => {
            const name = app.name || t("unnamed");
            return (
              <li key={app.clientId} className="account-row">
                <div>
                  <p>
                    <strong>{name}</strong>
                    {app.readOnly ? <span className="account-tag">{tTokens("readOnlyTag")}</span> : null}
                  </p>
                  <p className="account-row-meta">
                    {t("lastSignIn", { date: format.dateTime(new Date(app.lastIssuedAt), { dateStyle: "medium" }) })}
                  </p>
                </div>
                {confirming === app.clientId ? (
                  <div className="account-actions" role="group" aria-label={t("revokeConfirm", { name })}>
                    <span>{t("revokeConfirm", { name })}</span>
                    <button type="button" className="account-button is-primary" disabled={busy} onClick={() => revoke(app.clientId)}>
                      {tTokens("revokeYes")}
                    </button>
                    <button type="button" className="account-button" disabled={busy} onClick={() => setConfirming(null)}>
                      {tTokens("cancel")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="account-button"
                    disabled={busy}
                    aria-label={tTokens("revokeAria", { name })}
                    onClick={() => setConfirming(app.clientId)}
                  >
                    {tTokens("revoke")}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
