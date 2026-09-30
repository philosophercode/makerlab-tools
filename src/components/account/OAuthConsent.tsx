"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConsentResult } from "../../lib/account/oauth-consent";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RowStatus } from "../admin/RowStatus";

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
    <div className="mt-4 flex flex-col gap-4 border border-border bg-card p-4">
      <div className="flex items-start gap-2">
        <Checkbox
          id="consent-read-only"
          className="mt-0.5"
          checked={readOnly}
          aria-describedby="consent-read-only-hint"
          onCheckedChange={(value) => setReadOnly(value === true)}
        />
        <label htmlFor="consent-read-only" className="flex flex-col text-sm">
          <strong>{t("readOnly")}</strong>
          <span id="consent-read-only-hint" className="text-xs text-muted-foreground">
            {t("readOnlyHint")}
          </span>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="default" disabled={busy} onClick={() => decide(true)}>
          {t("allow")}
        </Button>
        <Button type="button" disabled={busy} onClick={() => decide(false)}>
          {t("deny")}
        </Button>
      </div>
      <RowStatus tone={error ? "bad" : "muted"} as="p" className="text-sm">
        {error}
      </RowStatus>
    </div>
  );
}
