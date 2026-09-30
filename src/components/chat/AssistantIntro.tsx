"use client";

import { BotMessageSquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FROSTED } from "../system/frosted";
import { cn } from "@/lib/utils";

/**
 * The first-visit callout beside the chat button (identity spec 2026-09-28
 * §3): "Meet the MakerLAB Assistant". Not a dialog — it takes no focus, traps
 * nothing and covers only its own corner, so the page stays usable. The
 * parent decides when it shows (`useAssistantIntroSeen`) and what opening and
 * dismissing do. The entrance animation runs only for viewers who allow motion.
 */
export function AssistantIntro({
  t,
  onOpen,
  onDismiss,
}: {
  t: (key: "introLabel" | "introTitle" | "introBody" | "introOpen" | "introDismiss") => string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <aside
      aria-label={t("introLabel")}
      data-slot="assistant-intro"
      className={cn(
        FROSTED,
        "ui fixed end-4 bottom-20 z-40 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-2 p-3 sm:end-6 sm:bottom-[5.5rem]",
        // Out of the way while any dialog is open (the tool page's QR dialog on
        // a phone): it sits outside the dialog's layer and would cover the page
        // around it. It comes back, still undismissed, when the dialog closes.
        "[body:has([role=dialog][data-state=open])_&]:hidden",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
      )}
    >
      <div className="flex items-start gap-2">
        <BotMessageSquareIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-ink" />
        <p className="flex-1 font-heading text-sm font-medium">{t("introTitle")}</p>
        <Button variant="ghost" size="icon-sm" className="-me-1.5 -mt-1.5" aria-label={t("introDismiss")} title={t("introDismiss")} onClick={onDismiss}>
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{t("introBody")}</p>
      <div>
        <Button size="sm" onClick={onOpen}>
          {t("introOpen")}
        </Button>
      </div>
    </aside>
  );
}
