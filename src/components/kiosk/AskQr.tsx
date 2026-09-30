import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { KIOSK_TYPE } from "./kiosk-type";

/**
 * The QR code that puts the assistant on the viewer's own phone (kiosk spec
 * §2, §5.4). On a wall screen or an iPad it is at least 30 % of the screen's
 * short side (`--kiosk-qr`, 32vmin), dark modules on the theme's lightest
 * token — high contrast without a pure-white block — with a quiet zone of
 * four modules or more around it (14 % of the code's width; the ask URL is a
 * 29-module code). The address is written under it for anybody whose camera
 * will not scan.
 *
 * On a phone (`kiosk-phone`) the reader is already holding one: the code
 * shrinks and sits beside an "Open the assistant" link to the same address.
 *
 * The SVG is made on the server from our own URL (`kioskQrSvg`), never from
 * anything a person typed.
 */
export function AskQr({ qrSvg, askUrl, className }: { qrSvg: string; askUrl: string; className?: string }) {
  const t = useTranslations("kiosk");
  return (
    <section
      aria-labelledby="kiosk-ask"
      className={cn(
        "flex min-w-0 flex-col items-center gap-[1.5vmin] text-center",
        "kiosk-phone:flex-row kiosk-phone:items-center kiosk-phone:gap-4 kiosk-phone:border kiosk-phone:border-border kiosk-phone:bg-card kiosk-phone:p-3 kiosk-phone:text-start",
        className
      )}
    >
      <div
        role="img"
        aria-label={t("qrLabel", { url: askUrl })}
        data-kiosk-qr={askUrl}
        className="shrink-0 bg-foreground p-[calc(var(--kiosk-qr)*0.14)] text-background"
      >
        <div className="size-(--kiosk-qr) [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      </div>
      <div className="flex min-w-0 flex-col items-center gap-[1.5vmin] kiosk-phone:items-start kiosk-phone:gap-2">
        <h2
          id="kiosk-ask"
          className={cn(KIOSK_TYPE.body, "max-w-[calc(var(--kiosk-qr)*1.3)] font-heading font-medium text-balance uppercase kiosk-wall:max-w-none kiosk-phone:max-w-none")}
        >
          {t("askHeading")}
        </h2>
        <a
          href={askUrl}
          data-kiosk-open=""
          className={cn(
            KIOSK_TYPE.small,
            "hidden min-h-11 items-center bg-primary px-4 font-medium text-primary-foreground kiosk-phone:inline-flex"
          )}
        >
          {t("openAssistant")}
        </a>
        <p className={cn(KIOSK_TYPE.label, "break-all normal-case tracking-normal")}>{displayHost(askUrl)}</p>
      </div>
    </section>
  );
}

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
