"use client";

import { useTranslations } from "next-intl";
import { can } from "../lib/auth/permissions";
import type { Role } from "../lib/auth/roles";
import { AsyncButton } from "./system/AsyncButton";

/**
 * "Refresh catalogue" — the staff control that invalidates the cached catalog
 * (ops hardening spec §3.2 path 1, §6).
 *
 * The catalog caches for a day, so a staff edit in Notion is invisible until
 * something invalidates. `/api/admin/revalidate` did that already, but only for
 * a caller holding the shared secret and willing to set a custom header — which
 * in practice meant nobody ever called it. This is that same endpoint with a
 * button in front of it.
 *
 * **The hiding is presentation, not access control.** The route re-resolves the
 * identity and refuses anyone without `tools.edit`; rendering `null` here only
 * spares everyone else a control they cannot use.
 *
 * It lives on `/admin`, in the home's header actions (and the ⌘K palette runs
 * the same request). It sat in the
 * header until 2026-09-23, when Isaac cleared the bar down to the page links,
 * Report and the profile menu.
 *
 * **Its state lives in the button** (`AsyncButton`, owner 2026-09-25): a
 * spinner while it runs, "Done" with a check for a moment when the catalog was
 * refreshed, and a failure said on the line beside it — no toast, and no
 * sentence left lying next to the button. Labelled **Refresh catalog**, so it
 * is never mistaken for refresh research.
 */

export const REVALIDATE_ENDPOINT = "/api/admin/revalidate";

interface RefreshCatalogButtonProps {
  /** The caller's role, or `undefined` while identity is still resolving. */
  role: Role | undefined;
}

export function RefreshCatalogButton({ role }: RefreshCatalogButtonProps) {
  const t = useTranslations("catalogRefresh");

  // Without a role that holds `tools.edit` nothing renders — a SuperMaker whose
  // grants change sees the control go, and nobody sees it flicker in.
  if (!can({ role }, "tools.edit")) return null;

  async function refresh(): Promise<true | string> {
    try {
      const res = await fetch(REVALIDATE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The session cookie is the credential; it rides along same-origin.
        body: "{}",
      });
      return res.ok ? true : t("failed");
    } catch {
      return t("failed");
    }
  }

  return (
    <AsyncButton onRun={refresh} doneLabel={t("done")} doneMessage={t("refreshed")}>
      {t("action")}
    </AsyncButton>
  );
}
