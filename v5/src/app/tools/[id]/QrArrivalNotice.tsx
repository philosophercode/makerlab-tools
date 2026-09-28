"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useChatLauncher } from "../../../components/ChatLauncherContext";

/** Marks traffic that arrived from a label on a machine. */
export const QR_SOURCE_PARAM = "src";
export const QR_SOURCE_VALUE = "qr";

interface QrArrivalNoticeProps {
  toolName: string;
}

/**
 * Shown only when the page was reached from a QR label on a machine.
 *
 * It *surfaces* the assistant rather than opening it: someone who scanned a
 * code is overwhelmingly likely to have a question about this machine, but a
 * panel that opens by itself over the specs they came to read is an
 * interruption (spec §5). Tapping opens the chat pre-seeded for this tool.
 *
 * `?src=qr` changes presentation only — never what data the page shows.
 */
export function QrArrivalNotice({ toolName }: QrArrivalNoticeProps) {
  const searchParams = useSearchParams();
  const t = useTranslations("qr");
  const { open } = useChatLauncher();

  if (searchParams?.get(QR_SOURCE_PARAM) !== QR_SOURCE_VALUE) return null;

  return (
    // Above the tool page's column, the same width; the accent start rule
    // marks it as the thing waiting on the visitor (UI system phase 5a).
    <div className="ui mx-auto w-full max-w-[1200px] px-4 pt-6 sm:px-8">
      <section
        aria-label={t("arrivalLabel")}
        className="flex flex-col gap-2 border border-s-4 border-border border-s-primary-ink bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("arrivalEyebrow")}</p>
          <h2 className="font-heading text-lg font-medium uppercase">{t("arrivalTitle", { tool: toolName })}</h2>
          <p className="text-sm text-muted-foreground">{t("arrivalBody")}</p>
        </div>
        <Button variant="default" className="self-start sm:self-auto" onClick={() => open(t("arrivalSeed", { tool: toolName }))}>
          {t("arrivalAction")}
        </Button>
      </section>
    </div>
  );
}
