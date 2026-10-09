"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { switchGoogleAccount } from "../../lib/auth/sign-in-client";
import { Button } from "@/components/ui/button";
import { RowStatus } from "../admin/RowStatus";

/**
 * "Use a different Google account" on `/auth/rejected` and `/auth/blocked`
 * (auth spec amendment 2026-10-07). Signs this browser out, then restarts
 * Google sign-in, which always shows Google's account chooser. `retryPath` is
 * the page the refused sign-in started from, so a good account lands where the
 * person meant to go (an MCP authorization included).
 */
export function UseDifferentAccount({ retryPath }: { retryPath: string }) {
  const t = useTranslations("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchAccount() {
    setBusy(true);
    setError(null);
    const outcome = await switchGoogleAccount(retryPath);
    if (outcome === "started") return;
    setBusy(false);
    setError(outcome === "unconfigured" ? t("switchUnconfigured") : t("switchFailed"));
  }

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button type="button" variant="default" className="h-10 w-full sm:h-8 sm:w-auto" disabled={busy} onClick={switchAccount}>
        {t("useDifferentAccount")}
      </Button>
      <RowStatus tone={error ? "bad" : "muted"} as="p" className="text-sm">
        {error}
      </RowStatus>
    </div>
  );
}
