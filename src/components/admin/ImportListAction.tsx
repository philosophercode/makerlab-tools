"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Intake's header action, **Import a list** (amendment 2026-09-25 "Admin
 * polish": importing is part of Intake, not a surface of its own). A link to
 * the import page; on that page it is not offered again, since a button that
 * reloads the page it is on is a dead end. The layout shows it only to holders
 * of `tools.add`, and the page checks that itself.
 */
export function ImportListAction({ href }: { href: string }) {
  const t = useTranslations("admin.addEquipment");
  const pathname = (usePathname() ?? "").replace(/\/+$/, "");
  if (pathname === href) return null;
  return (
    <Button asChild variant="default">
      <Link href={href}>{t("importList")}</Link>
    </Button>
  );
}
