"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { canReachAdmin } from "../lib/auth/permissions";
import type { Role } from "../lib/auth/roles";

/**
 * ADMIN, the way into `/admin`, in the header's bar (spec §6; identity spec
 * amendment "ADMIN in the bar", 2026-10-07).
 *
 * It sat in the bar until 2026-09-23, then in the profile menu; on 2026-10-07
 * Isaac moved it back into the bar, where REPORT used to be, for the people
 * who can use it.
 *
 * Shown to anyone holding *any* admin-surface permission, not only a super
 * admin: a SuperMaker's queues land behind this same link, and one entry point
 * that grows is better than a link that appears when a phase merges.
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
  onClick?: () => void;
}

export function AdminLink({ role, className, onClick }: AdminLinkProps) {
  const t = useTranslations("nav");

  if (!canReachAdmin({ role })) return null;

  return (
    <Link className={className ?? "primary-nav-admin"} href={ADMIN_HREF} onClick={onClick}>
      {t("admin")}
    </Link>
  );
}
