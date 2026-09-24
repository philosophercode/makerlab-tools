"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { canReachAdmin } from "../lib/auth/permissions";
import type { Role } from "../lib/auth/roles";

/**
 * The way into `/admin`, from the header's profile menu (spec §6).
 *
 * It sat in the nav bar itself until 2026-09-23, when Isaac moved every
 * signed-in control into the profile menu. `menuItem` renders it as one of that
 * menu's items (role and roving tab stop); without it, it is a plain link.
 *
 * Shown to anyone holding *any* admin-surface permission, not only a super
 * admin: a SuperMaker's queues arrive in later phases and land behind this same
 * link, and one entry point that grows is better than a link that appears when
 * Phase 5 merges.
 *
 * **Hiding is presentation.** `/admin`'s layout resolves the identity itself
 * and refuses anyone without one of these permissions; rendering `null` here
 * only spares everyone else a link into a refusal. Same contract as
 * `RefreshCatalogButton`, and the same reason `role` may be `undefined` — the
 * header asks `/api/identity` after mount, and until it answers there is
 * nothing to show.
 */

export const ADMIN_HREF = "/admin";

interface AdminLinkProps {
  role: Role | undefined;
  className?: string;
  /** Render as a `role="menuitem"` whose focus the menu manages. */
  menuItem?: boolean;
  onClick?: () => void;
}

export function AdminLink({ role, className, menuItem = false, onClick }: AdminLinkProps) {
  const t = useTranslations("nav");

  if (!canReachAdmin({ role })) return null;

  return (
    <Link
      className={className ?? "primary-nav-admin"}
      href={ADMIN_HREF}
      role={menuItem ? "menuitem" : undefined}
      tabIndex={menuItem ? -1 : undefined}
      onClick={onClick}
    >
      {t("admin")}
    </Link>
  );
}
