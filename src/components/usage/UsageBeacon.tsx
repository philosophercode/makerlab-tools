"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Usage Insight's page-view beacon (usage insight spec §3.3, §5.3).
 *
 * Tool pages are cached, so the server never sees a view; this island tells
 * it, once per tool per tab session (deduplicated in `sessionStorage`), with
 * `navigator.sendBeacon` so it never delays the page or blocks unload. What it
 * sends is `{ kind, toolId, source }` — `source` is `qr` when the URL carries
 * `?src=qr` (a label on a machine) — and nothing about the visitor. A browser
 * without `sendBeacon`, or one that blocks it, is simply not counted.
 *
 * `kind: "kiosk_view"` is an arrival from the kiosk's QR code (`?src=kiosk`).
 */
export interface UsageBeaconProps {
  kind: "tool_view" | "kiosk_view";
  toolId?: string;
}

export const USAGE_ENDPOINT = "/api/usage";

export function UsageBeacon({ kind, toolId }: UsageBeaconProps) {
  const searchParams = useSearchParams();
  const src = searchParams?.get("src") ?? null;

  useEffect(() => {
    if (kind === "kiosk_view" && src !== "kiosk") return;
    const source = kind === "tool_view" ? (src === "qr" ? "qr" : "direct") : "qr";
    const key = `usage:${kind}:${toolId ?? "-"}:${source}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked (a private window): count this view, dedupe nothing.
    }
    try {
      if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
      const body = new Blob([JSON.stringify({ kind, ...(toolId ? { toolId } : {}), source })], { type: "application/json" });
      navigator.sendBeacon(USAGE_ENDPOINT, body);
    } catch {
      // Counting a view never breaks the page.
    }
  }, [kind, toolId, src]);

  return null;
}
