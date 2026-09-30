"use client";

import { useState, useSyncExternalStore } from "react";
import { Copy, Download, QrCode, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FROSTED } from "../system/frosted";
import { RowStatus } from "../admin/RowStatus";
import { displayUrl, qrFileName, qrImagePath } from "../../lib/qr/urls";

/**
 * **QR code** on a published tool's page (QR labels): a quiet control beside
 * "Report a correction" that opens the tool's code in a `Dialog` — the same
 * code the lab's machine labels carry (`?src=qr`), so a code saved from here
 * and taped to the machine behaves like a printed one.
 *
 * Download PNG / SVG are links to `/api/qr/<slug>` (attachments); Copy link
 * copies the plain page address (a copied link is not a scan); Share hands
 * the PNG and the link to the phone's share sheet where the browser can share
 * files, else just the link, and is not drawn where there is no share sheet.
 *
 * The page is a cached prerender, so the URLs arrive as props from the server
 * (`qrSiteUrl`) and nothing here asks who is looking.
 */
export interface ToolQrButtonProps {
  slug: string;
  toolName: string;
  /** `<site>/tools/<slug>` — copied and shared. */
  pageUrl: string;
  /** `<site>/tools/<slug>?src=qr` — what the code encodes. */
  scanUrl: string;
}

type CopyState = "idle" | "copied" | "failed";

function subscribeNothing(): () => void {
  return () => {};
}

function browserCanShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

export function ToolQrButton({ slug, toolName, pageUrl, scanUrl }: ToolQrButtonProps) {
  const t = useTranslations("qr");
  const [copy, setCopy] = useState<CopyState>("idle");
  // Known only in the browser, after hydration: the server never draws Share.
  const canShare = useSyncExternalStore(subscribeNothing, browserCanShare, () => false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopy("copied");
    } catch {
      setCopy("failed");
    }
  }

  async function share() {
    const title = t("shareTitle", { tool: toolName });
    try {
      const response = await fetch(qrImagePath(slug, "png", { size: 1024 }));
      const blob = response.ok ? await response.blob() : null;
      const file = blob ? new File([blob], qrFileName(slug, "png"), { type: "image/png" }) : null;
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, text: title, url: pageUrl, files: [file] });
      } else {
        await navigator.share({ title, url: pageUrl });
      }
    } catch (error) {
      // Dismissing the share sheet is an AbortError: nothing to say.
      if ((error as { name?: string })?.name === "AbortError") return;
      try {
        await navigator.share({ title, url: pageUrl });
      } catch {
        // The link is still on screen to copy.
      }
    }
  }

  return (
    <Dialog onOpenChange={(open) => (open ? undefined : setCopy("idle"))}>
      <DialogTrigger asChild>
        <Button variant="link" className="h-auto gap-1 px-0 py-1 font-mono text-label text-muted-foreground normal-case underline hover:text-foreground">
          <QrCode aria-hidden="true" />
          {t("shareTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("close")} className={cn(FROSTED, "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md")}>
        <DialogHeader>
          <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("shareEyebrow")}</p>
          <DialogTitle>{t("shareTitle", { tool: toolName })}</DialogTitle>
          <DialogDescription>{t("shareDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-2">
          {/* White plate in both themes: a code needs light around dark to scan off a screen. */}
          <div className="border border-border bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- an SVG from our own route; nothing for next/image to do */}
            <img
              src={qrImagePath(slug, "svg")}
              alt={t("imageAlt", { tool: toolName })}
              width={208}
              height={208}
              className="block size-52"
              data-qr-scan={scanUrl}
            />
          </div>
          <p className="max-w-full font-mono text-label break-all text-muted-foreground">{displayUrl(pageUrl)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button asChild>
            <a href={qrImagePath(slug, "png", { size: 1024, download: true })} download={qrFileName(slug, "png")}>
              <Download aria-hidden="true" />
              {t("downloadPng")}
            </a>
          </Button>
          <Button asChild>
            <a href={qrImagePath(slug, "svg", { download: true })} download={qrFileName(slug, "svg")}>
              <Download aria-hidden="true" />
              {t("downloadSvg")}
            </a>
          </Button>
          <Button onClick={copyLink} className={canShare ? undefined : "col-span-2"}>
            <Copy aria-hidden="true" />
            {copy === "copied" ? t("copied") : t("copyLink")}
          </Button>
          {canShare ? (
            <Button variant="default" onClick={share}>
              <Share2 aria-hidden="true" />
              {t("share")}
            </Button>
          ) : null}
        </div>
        {copy === "failed" ? (
          <RowStatus tone="bad" role="alert">
            {t("copyFailed")}
          </RowStatus>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
