"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useChatLauncher } from "../ChatLauncherContext";
import { canAddEquipment } from "../../lib/capabilities/access";
import type { Role } from "../../lib/auth/roles";

/**
 * **Add inventory** on `/admin/inventory` (amendment 2026-09-25 "Admin
 * polish"): the header's primary action, and the same flow as the home's and
 * the profile menu's **Add equipment** — the assistant opens with the intake
 * seed, identifies what is being added, and research and approval follow on
 * Intake. There is no second way to add a tool, only a second place to start.
 *
 * Shown to holders of `tools.add`; hiding is presentation, and the chat
 * composes intake only for them.
 */
export function AddInventoryButton({ role }: { role: Role }) {
  const t = useTranslations();
  const { open } = useChatLauncher();
  if (!canAddEquipment({ role })) return null;
  return (
    <Button variant="default" onClick={() => open(t("nav.addSeed"))}>
      {t("admin.inventory.addInventory")}
    </Button>
  );
}
