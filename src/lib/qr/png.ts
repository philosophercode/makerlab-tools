import "server-only";

import { toBuffer } from "qrcode";
import type { QrErrorLevel } from "./matrix";

/**
 * A code as a PNG, black on white with the standard four-module quiet zone —
 * what the Download PNG links and the native share sheet hand out. Square,
 * at most `sizePx` and within one module of it: `qrcode` draws whole-pixel
 * modules, which is what keeps the edges crisp for a camera.
 * Server-side (`qrcode`'s PNG writer uses Node's zlib).
 */
export async function qrPng(text: string, sizePx: number, level: QrErrorLevel = "H"): Promise<Buffer> {
  return toBuffer(text, {
    type: "png",
    errorCorrectionLevel: level,
    margin: 4,
    width: sizePx,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
