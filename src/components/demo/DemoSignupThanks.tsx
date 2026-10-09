"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatPassDate, formatUsd } from "../../lib/demo-pass/format";
import type { DemoPassView } from "../../lib/demo-pass/state";
import { useChatLauncher } from "../ChatLauncherContext";
import { Prose } from "../system/PublicPage";

/**
 * After the demo sign-up (demo pass spec 2026-10-07 §5.1, §6): the thank-you,
 * in the version the route's answer calls for — a new pass, the same pass
 * again on this device, an email whose pass has ended, or (for a filled
 * honeypot) a plain thanks. Focus moves to the heading so a screen reader
 * hears that it worked. **Ask the assistant** opens the chat right here.
 */
export function DemoSignupThanks({
  status,
  pass,
}: {
  status: "created" | "existing" | "expired" | "received";
  pass: DemoPassView | null;
}) {
  const t = useTranslations("demoPass");
  const locale = useLocale();
  const { open } = useChatLauncher();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const date = pass ? formatPassDate(pass.expiresAt, locale) : "";
  const body =
    status === "created" && pass
      ? t("thanksBody", { date, budget: formatUsd(pass.budgetUsd, locale) })
      : status === "existing" && pass
        ? t("thanksReturning", { date, remaining: formatUsd(pass.remainingUsd, locale) })
        : status === "expired"
          ? t("thanksExpired")
          : t("thanksReceived");
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
