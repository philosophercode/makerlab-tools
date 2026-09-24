"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConsentResult } from "../../lib/account/oauth-consent";
import "../../styles/account.css";

/**
 * The consent page's buttons (MCP access spec §3.4): Allow or Deny, with
 * read-only as an option. The decision goes to a server action, which answers
 * where to send the browser — back to the app that asked, with a code or with
 * `access_denied`.
 */
export function OAuthConsent({
  consentCode,
  action,
}: {
  consentCode: string;
  action: (input: { consentCode: string; accept: boolean; readOnly: boolean }) => Promise<ConsentResult>;
}) {
  const t = useTranslations("account.oauth");
  const [readOnly, setReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const result = await action({ consentCode, accept, readOnly });
      if (!result.ok) {
        setError(result.error === "expired" ? t("expired") : t("failed"));
        setBusy(false);
        return;
      }
      window.location.assign(result.redirectURI);
    } catch {
      setError(t("failed"));
      setBusy(false);
    }
  }

  return (
    <div className="account-form">
      <label className="account-check">
        <input type="checkbox" checked={readOnly} onChange={(event) => setReadOnly(event.target.checked)} />
        <span>
          <strong>{t("readOnly")}</strong>
          <br />
          <span className="account-field-hint">{t("readOnlyHint")}</span>
        </span>
      </label>
      <div className="account-actions">
        <button type="button" className="account-button is-primary" disabled={busy} onClick={() => decide(true)}>
          {t("allow")}
        </button>
        <button type="button" className="account-button" disabled={busy} onClick={() => decide(false)}>
          {t("deny")}
        </button>
      </div>
      <p className={`account-status${error ? " is-error" : ""}`} role="status">
        {error ?? ""}
      </p>
    </div>
  );
}
