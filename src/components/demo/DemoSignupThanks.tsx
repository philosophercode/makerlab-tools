"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DemoPassView } from "../../lib/demo-pass/state";
import { siteConfig } from "../../lib/site-config";
import { useChatLauncher } from "../ChatLauncherContext";
import { Prose } from "../system/PublicPage";

/**
 * After the sign-up (demo pass spec 2026-10-07 §5.1, §6; amendment
 * 2026-10-11): a short thank-you that says nothing about a pass. A new
 * sign-up (or a filled honeypot, which must look the same) hears "we'll be in
 * touch"; an address already signed up hears that we have its details. Focus
 * moves to the heading so a screen reader hears that it worked. When the
 * answer carries a live pass, **Ask the assistant** opens the chat right here.
 */
export function DemoSignupThanks({
  status,
  pass,
}: {
  status: "created" | "existing" | "expired" | "received";
  pass: DemoPassView | null;
}) {
  const t = useTranslations("demoPass");
  const { open } = useChatLauncher();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const body =
    status === "existing" || status === "expired" ? t("thanksReturning") : t("thanksBody", { assistant: siteConfig.chatAssistantName });
  const hasPass = Boolean(pass) && (status === "created" || status === "existing");

  return (
    <section aria-labelledby="demo-thanks-title" className="flex flex-col gap-4 pt-6" data-slot="demo-thanks">
      <h2 id="demo-thanks-title" ref={headingRef} tabIndex={-1} className="font-heading text-2xl font-medium normal-case outline-none">
        {t("thanksTitle")}
      </h2>
      <Prose>
        <p role="status">{body}</p>
        {hasPass ? <p>{t("thanksNext")}</p> : null}
      </Prose>
      <div className="flex flex-wrap gap-2">
        {hasPass ? (
          <Button variant="default" aria-haspopup="dialog" onClick={() => open()}>
            <MessageSquareIcon aria-hidden="true" />
            {t("askAssistant")}
          </Button>
        ) : null}
        <Button asChild variant={hasPass ? "quiet" : "default"}>
          <Link href="/">{t("browseTools")}</Link>
        </Button>
      </div>
    </section>
  );
}
