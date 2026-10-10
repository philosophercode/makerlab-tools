"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { DemoPassView } from "../../lib/demo-pass/state";
import { Message, MessageContent } from "../ai-elements/message";

/**
 * The chat's demo pass words (demo pass spec 2026-10-07 §6).
 *
 * - {@link DemoPassIndicator}: "Demo access" under the sheet's title, or
 *   "limit reached". No amount (amendment "Sign up to learn more",
 *   2026-10-10: the visitor is not told about a credit). Not a live region.
 * - {@link DemoPassSpentNotice}: the thank-you once the pass is spent — that
 *   the visitor can keep asking at the visitor limit (or, when that limit is
 *   reached too, that they can try again later) — and the contact line.
 */

export function DemoPassIndicator({ pass }: { pass: DemoPassView }) {
  const t = useTranslations("chat");
  return (
    <p data-slot="demo-pass-indicator" className="m-0 font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">
      {pass.exhausted ? t("demoPassUsedUp") : t("demoPassActive")}
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
