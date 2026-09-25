"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useChatLauncher } from "../ChatLauncherContext";
import { RefreshCatalogButton } from "../RefreshCatalogButton";
import { canAddEquipment } from "../../lib/capabilities/access";
import { can } from "../../lib/auth/permissions";
import type { Role } from "../../lib/auth/roles";

/**
 * The actions in the `/admin` home's header: Add equipment and Refresh
 * catalog (both are also in the ⌘K palette).
 *
 * Both used to sit in the header; on 2026-09-23 Isaac cleared the bar, and the
 * two staff actions came here (Add is also in the profile menu). A client
 * island because both need the browser — Add opens the chat launcher, which the
 * root layout provides to every page, `/admin` included — while the page around
 * it stays a server component.
 *
 * Each control keeps its own permission rule: Add needs `tools.add`, Refresh
 * `tools.edit`. The row renders nothing when neither applies, and as elsewhere
 * the hiding is presentation; the chat and the revalidate route check again.
 */
export function AdminActions({ role }: { role: Role }) {
  const t = useTranslations();
  const { open } = useChatLauncher();
  const canAdd = canAddEquipment({ role });
  // RefreshCatalogButton applies this same rule and renders nothing without it;
  // it is asked here too only to decide whether the row exists at all.
  const canRefresh = can({ role }, "tools.edit");

  if (!canAdd && !canRefresh) return null;

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("admin.actionsLabel")}>
      {canAdd ? (
        <Button variant="default" onClick={() => open(t("nav.addSeed"))}>
          {t("nav.addEquipment")}
        </Button>
      ) : null}
      <RefreshCatalogButton role={role} />
    </div>
  );
}
