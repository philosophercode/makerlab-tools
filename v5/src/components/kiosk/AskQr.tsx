import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { KIOSK_TYPE } from "./kiosk-type";

/**
 * The QR code that puts the assistant on the viewer's own phone (kiosk spec
 * §2, §5.4). At least 30 % of the screen's short side (32vmin), dark modules
 * on the theme's lightest token — high contrast without a pure-white block —
 * with a quiet zone of four modules or more around it. The address is
 * written under it for anybody whose camera will not scan.
 *
 * The SVG is made on the server from our own URL (`kioskQrSvg`), never from
 * anything a person typed.
 */
export function AskQr({ qrSvg, askUrl, className }: { qrSvg: string; askUrl: string; className?: string }) {
  const t = useTranslations("kiosk");
  return (
    <section aria-labelledby="kiosk-ask" className={cn("flex flex-col items-center gap-[1.5vmin] text-center", className)}>
      <div role="img" aria-label={t("qrLabel", { url: askUrl })} data-kiosk-qr={askUrl} className="bg-foreground p-[4vmin] text-background">
        <div className="size-[clamp(200px,32vmin,640px)] [&>svg]:block [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      </div>
      <h2 id="kiosk-ask" className={cn(KIOSK_TYPE.body, "max-w-[46vmin] font-heading font-medium uppercase portrait:max-w-none")}>
        {t("askHeading")}
      </h2>
      <p className={cn(KIOSK_TYPE.label, "normal-case tracking-normal")}>{displayHost(askUrl)}</p>
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
