"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { can } from "../lib/auth/permissions";
import type { Role } from "../lib/auth/roles";
import { siteConfig } from "../lib/site-config";

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
 * It lives on `/admin`, in the action row above the surfaces list. It sat in the
 * header until 2026-09-23, when Isaac cleared the bar down to the page links,
 * Report and the profile menu.
 *
 * Feedback stays on screen until the next attempt rather than firing a toast —
 * a refresh is something staff want confirmed, and a toast is gone before it is
 * read (the same reasoning as `FlagButton`'s in-place confirmation).
 */

export const REVALIDATE_ENDPOINT = "/api/admin/revalidate";

type RefreshState = "idle" | "refreshing" | "refreshed" | "failed";

interface RefreshCatalogButtonProps {
  /** The caller's role, or `undefined` while identity is still resolving. */
  role: Role | undefined;
}

export function RefreshCatalogButton({ role }: RefreshCatalogButtonProps) {
  const t = useTranslations("catalogRefresh");
  const [state, setState] = useState<RefreshState>("idle");

  // Without a role that holds `tools.edit` nothing renders — a SuperMaker whose
  // grants change sees the control go, and nobody sees it flicker in.
  if (!can({ role }, "tools.edit")) return null;

  async function handleRefresh() {
    if (state === "refreshing") return;
    setState("refreshing");
    try {
      const res = await fetch(REVALIDATE_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The session cookie is the credential; it rides along same-origin.
        body: "{}",
      });
      setState(res.ok ? "refreshed" : "failed");
    } catch {
      setState("failed");
    }
  }

  const statusKey =
    state === "idle" ? null : (state as "refreshing" | "refreshed" | "failed");

  return (
    <>
      <style href="makerlab-refresh-catalog" precedence="medium">
        {REFRESH_STYLES}
      </style>

      <button
        type="button"
        // The admin action row's chrome (globals.css, `.admin-action`).
        className="admin-action catalog-refresh"
        onClick={handleRefresh}
        disabled={state === "refreshing"}
        aria-label={t("actionAria", { institution: siteConfig.institution })}
      >
        {t("action")}
      </button>
      {/* Always in the DOM so the live region is there before it has anything
          to say; `:empty` keeps it out of the layout until it does. */}
      <span
        className={`catalog-refresh-status${state === "failed" ? " is-failed" : ""}`}
        role="status"
      >
        {statusKey ? t(statusKey) : ""}
      </span>
    </>
  );
}

/**
 * Scoped styles, hoisted and deduped by React 19 (`precedence`). They live here
 * rather than in `globals.css` for the same reason `FlagButton`'s do — the
 * component arrived under separate file ownership, and folding them into the
 * stylesheet later is a no-op. Everything reads global theme tokens; the
 * action row supplies the mono/uppercase treatment.
 */
const REFRESH_STYLES = `
.catalog-refresh-status {
  align-self: center;
  color: var(--on-surface-muted);
  font: inherit;
}
.catalog-refresh-status:empty {
  display: none;
}
.catalog-refresh-status.is-failed {
  color: var(--status-bad);
}
`;
