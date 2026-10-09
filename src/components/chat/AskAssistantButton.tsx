"use client";

import { MessageSquareIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useChatLauncher } from "../ChatLauncherContext";

/**
 * **Ask MakerLAB AI**, at the end of the admin section bar (UI system phase
 * 5b; owner decision 6; the assistant's name everywhere since the owner's
 * decisions of 2026-10-07): the admin's way into the chat, since the floating
 * button is not drawn on admin pages (it collided with the bulk-action bars).
 * The words show from `sm`; on a phone the icon stands alone and the words
 * stay its accessible name.
 */
export function AskAssistantButton() {
  const t = useTranslations("chat");
  const { open } = useChatLauncher();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-haspopup="dialog"
      onClick={() => open()}
      className="gap-1.5"
    >
      <MessageSquareIcon aria-hidden="true" className="size-3.5" />
      <span className="max-sm:sr-only">{t("askAssistant")}</span>
    </Button>
  );
}
