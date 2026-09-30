"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { ToolQrCardPayload } from "../../lib/capabilities/qr";
import { qrFileName } from "../../lib/qr/urls";

/**
 * The assistant's answer to "can I have a QR code for this?" — the
 * `data-tool-qr` part `get_tool_qr_code` writes: the code on a white plate,
 * what scanning it opens, and Download PNG / SVG links to `/api/qr/<slug>`.
 * Every URL in the payload was built on the server from the catalogue's own
 * slug, never from model text.
 */
export function ToolQrCard({ payload }: { payload: ToolQrCardPayload }) {
  const t = useTranslations("chat.qrCard");
  return (
    <figure data-kind="tool-qr" className="flex w-full items-start gap-3 border border-border bg-card p-3">
      <div className="shrink-0 border border-border bg-white p-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element -- an SVG from our own route */}
        <img src={payload.imageUrl} alt={t("alt", { tool: payload.name })} width={112} height={112} className="block size-28" />
      </div>
      <figcaption className="flex min-w-0 flex-col gap-1.5">
        <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("label")}</p>
        <p className="text-sm font-medium">{payload.name}</p>
        <p className="text-xs break-all text-muted-foreground">{t("opens", { url: payload.shortUrl })}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm">
            <a href={payload.pngUrl} download={qrFileName(payload.slug, "png")}>
              <Download aria-hidden="true" />
              {t("downloadPng")}
            </a>
          </Button>
          <Button asChild size="sm">
            <a href={payload.svgUrl} download={qrFileName(payload.slug, "svg")}>
              <Download aria-hidden="true" />
              {t("downloadSvg")}
            </a>
          </Button>
        </div>
      </figcaption>
    </figure>
  );
}
