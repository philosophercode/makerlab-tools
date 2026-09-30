import { QR_IMAGE_FORMATS, QR_PNG_DEFAULT_PX, QR_PNG_MAX_PX, QR_PNG_MIN_PX, type QrImageFormat } from "./urls";

/** `/api/qr/[slug]`'s query: `format` (svg default), `size` (PNG px, bounded), `download`. */
export function parseQrQuery(search: URLSearchParams): { format: QrImageFormat; size: number; download: boolean } | { error: string } {
  const format = (search.get("format") ?? "svg").toLowerCase();
  if (!(QR_IMAGE_FORMATS as readonly string[]).includes(format)) return { error: "invalid_format" };
  const rawSize = search.get("size");
  let size = QR_PNG_DEFAULT_PX;
  if (rawSize !== null) {
    if (!/^\d{1,4}$/.test(rawSize)) return { error: "invalid_size" };
    size = Number(rawSize);
    if (size < QR_PNG_MIN_PX || size > QR_PNG_MAX_PX) return { error: "invalid_size" };
  }
  const download = search.get("download") === "1";
  return { format: format as QrImageFormat, size, download };
}
