import "server-only";

import { toString as toQrString } from "qrcode";

/**
 * The kiosk's QR code (kiosk spec §2, §5.4), as an SVG string made on the
 * server with the `qrcode` package the label generator already uses. It
 * encodes `kioskAskUrl()` (`./params.ts`): the catalogue with the assistant
 * open.
 *
 * - **Colours come from the page, not from here.** The modules are drawn in
 *   `currentColor` on a transparent ground, so the plate behind it supplies
 *   the light colour from the theme's tokens — high contrast, never a
 *   full-white block on a screen that runs for days (§5.5).
 * - **Error correction M**, not the labels' H: a screen is not a sticker on a
 *   milling machine, and fewer, larger modules scan better from 3 m.
 * - **No quiet zone in the SVG.** The plate around it is the quiet zone, sized
 *   by the page.
 */
export async function kioskQrSvg(url: string): Promise<string> {
  const svg = await toQrString(url, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 0,
    color: { dark: "#000000", light: "#0000" },
  });
  return svg.replace(/stroke="#000000"/g, 'stroke="currentColor"');
}
