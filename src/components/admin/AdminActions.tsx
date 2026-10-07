"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Boxes, ClipboardCheck, PackagePlus, QrCode } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useChatLauncher } from "../ChatLauncherContext";
import { canAddEquipment } from "../../lib/capabilities/access";
import { can } from "../../lib/auth/permissions";
import type { Role } from "../../lib/auth/roles";

/**
 * **Quick actions** on the `/admin` overview (admin sections spec 2026-10-07;
 * the review's "Today" mock-up): the few things a shift starts from.
 *
 * - **Print QR labels** first and largest (`tools.edit`): labels stay easy to
 *   find (owner, 2026-10-07). It opens Inventory › QR labels.
 * - **Log finished work** (`maintenance.manage`): the tickets page's form for
 *   work already done.
 * - **Add equipment** (`tools.add`): opens the assistant with the intake seed,
 *   the same flow as the profile menu's and the inventory's.
 * - **All tools** (`tools.edit`): the inventory, where the tool editor opens.
 *
 * Refresh catalog, which sat here until 2026-10-07, is under Settings ›
 * General and in the ⌘K palette. A client island because Add needs the chat
 * launcher. Each control keeps its own permission rule and the row renders
 * nothing when none applies; hiding is presentation, every page and the chat
 * check again.
 */
export function AdminActions({ role }: { role: Role }) {
  const t = useTranslations();
  const { open } = useChatLauncher();
  const subject = { role };
  const canAdd = canAddEquipment(subject);
  const canEdit = can(subject, "tools.edit");
  const canMaintain = can(subject, "maintenance.manage");

  if (!canAdd && !canEdit && !canMaintain) return null;

  return (
    <div className="flex flex-col gap-2" role="group" aria-label={t("admin.actionsLabel")}>
      {canEdit ? (
        <Link
          href="/admin/inventory/qr"
          className="group flex items-center gap-3 border border-border bg-background p-3 transition-colors hover:border-foreground"
        >
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center bg-foreground text-background">
            <QrCode className="size-5" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-base font-medium">{t("admin.overview.printLabels")}</span>
            <span className="text-xs text-muted-foreground">{t("admin.overview.printLabelsHint")}</span>
          </span>
          <span aria-hidden="true" className="ms-auto text-muted-foreground group-hover:text-foreground">
            →
          </span>
        </Link>
      ) : null}
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {canMaintain ? (
          <QuickLink href="/admin/maintenance#log-completed" icon={<ClipboardCheck aria-hidden="true" />}>
            {t("admin.overview.logFinished")}
          </QuickLink>
        ) : null}
        {canAdd ? (
          <button type="button" className={quick} onClick={() => open(t("nav.addSeed"))}>
            <PackagePlus aria-hidden="true" />
            {t("nav.addEquipment")}
          </button>
        ) : null}
        {canEdit ? (
          <QuickLink href="/admin/inventory" icon={<Boxes aria-hidden="true" />}>
            {t("admin.overview.allTools")}
          </QuickLink>
        ) : null}
      </div>
    </div>
  );
}

const quick = cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 justify-start gap-2 [&_svg]:size-4");

function QuickLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Link href={href} className={quick}>
      {icon}
      {children}
    </Link>
  );
}
