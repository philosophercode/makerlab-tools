"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { canReachAdmin } from "../lib/auth/permissions";
import type { Role } from "../lib/auth/roles";

/**
 * The way into `/admin`, in the header (spec §6).
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

export function AdminLink({ role }: { role: Role | undefined }) {
  const t = useTranslations("nav");

  if (!canReachAdmin({ role })) return null;

  return (
    <Link className="primary-nav-admin" href={ADMIN_HREF}>
      {t("admin")}
    </Link>
  );
}
