"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { isAtLeast, type Role } from "../lib/auth/roles";
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
 * identity and refuses anyone below `staff`; rendering `null` here only spares
 * everyone else a control they cannot use.
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

  // Until identity resolves, `role` is undefined and nothing renders — the same
  // treatment the header gives the signed-in name, and the reason a student
  // never sees the control flicker into existence.
  if (!role || !isAtLeast(role, "staff")) return null;

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
        // Borrows the report control's nav-action chrome (transparent, 0 radius,
        // inherited mono label); the modifier is the hook if they diverge.
        className="primary-nav-report primary-nav-refresh"
        onClick={handleRefresh}
        disabled={state === "refreshing"}
        aria-label={t("actionAria", { institution: siteConfig.institution })}
      >
        {t("action")}
      </button>
      {/* Always in the DOM so the live region is there before it has anything
          to say; `:empty` keeps it out of the layout until it does. */}
      <span
        className={`primary-nav-refresh-status${state === "failed" ? " is-failed" : ""}`}
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
 * stylesheet later is a no-op. Everything reads global theme tokens, and the
 * nav's own mono/uppercase treatment already applies.
 */
const REFRESH_STYLES = `
.primary-nav-refresh-status {
  align-self: center;
  padding-block: 8px;
  color: var(--on-surface-muted);
  font: inherit;
}
.primary-nav-refresh-status:empty {
  display: none;
}
.primary-nav-refresh-status.is-failed {
  color: var(--secondary);
}
`;
