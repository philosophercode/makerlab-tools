"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { startGoogleSignIn } from "../../lib/auth/sign-in-client";
import "../../styles/account.css";

/**
 * "Sign in with Google" on `/oauth/sign-in` (MCP access spec §3.4). Starts the
 * ordinary Google sign-in — the same provider and the same allowed-domain
 * rules as the header's button — and returns to the authorization the app
 * asked for, which then continues to the consent page.
 */
export function OAuthSignIn({ resumeUrl }: { resumeUrl: string }) {
  const t = useTranslations("account.oauth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    const outcome = await startGoogleSignIn(resumeUrl);
    if (outcome === "started") return;
    setBusy(false);
    setError(outcome === "unconfigured" ? t("signInUnconfigured") : t("signInFailed"));
  }

  return (
    <div className="account-actions">
      <button type="button" className="account-button is-primary" disabled={busy} onClick={signIn}>
        {t("signInButton")}
      </button>
      <p className={`account-status${error ? " is-error" : ""}`} role="status">
        {error ?? ""}
      </p>
    </div>
  );
}
