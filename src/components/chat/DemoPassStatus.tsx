"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatUsd } from "../../lib/demo-pass/format";
import type { DemoPassView } from "../../lib/demo-pass/state";
import { Message, MessageContent } from "../ai-elements/message";

/**
 * The chat's demo pass words (demo pass spec 2026-10-07 §6).
 *
 * - {@link DemoPassIndicator}: "Demo pass · $0.42 left" under the sheet's
 *   title, or "used up". Not a live region: a balance that ticks down after
 *   every answer would interrupt each one.
 * - {@link DemoPassSpentNotice}: the thank-you once the pass is spent — that
 *   the visitor can keep asking at the visitor limit (or, when that limit is
 *   reached too, that they can try again later) — and the contact line.
 */

export function DemoPassIndicator({ pass }: { pass: DemoPassView }) {
  const t = useTranslations("chat");
  const locale = useLocale();
  return (
    <p data-slot="demo-pass-indicator" className="m-0 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase tabular-nums">
      {pass.exhausted ? t("demoPassUsedUp") : t("demoPassLeft", { amount: formatUsd(pass.remainingUsd, locale) })}
    </p>
  );
}

export function DemoPassSpentNotice({ contactEmail, limited, onNavigate }: { contactEmail: string | null; limited: boolean; onNavigate?: () => void }) {
  const t = useTranslations("chat");
  return (
    <Message from="assistant" kind="notice">
      <MessageContent>
        <p>{limited ? t("demoPassLimited") : t("demoPassSpent")}</p>
        <p>
          {t("demoPassContactLead")}{" "}
          {contactEmail ? (
            <a className="text-primary-ink underline-offset-4 hover:underline" href={`mailto:${contactEmail}`}>
              {contactEmail}
            </a>
          ) : (
            <Link className="text-primary-ink underline-offset-4 hover:underline" href="/about#about-people" onClick={onNavigate}>
              {t("demoPassContactTeam")}
            </Link>
          )}
        </p>
      </MessageContent>
    </Message>
  );
}
