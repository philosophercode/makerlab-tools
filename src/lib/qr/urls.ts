/**
 * What a tool's QR code encodes, and where its image is served — one module
 * shared by the label script (`scripts/generate-qr-labels.ts`), the tool
 * page's arrival notice, the admin label sheets, the tool page's QR dialog and
 * the assistant's `get_tool_qr_code`, so a label printed from any of them
 * behaves the same when it is scanned (QR codes spec §3).
 *
 * Pure and dependency-free: the label script imports it under plain Node
 * (`--experimental-strip-types`), and client components import it too.
 */

/** Marks traffic that arrived from a label on a machine (spec §3, §8). */
export const QR_SOURCE_PARAM = "src";
export const QR_SOURCE_VALUE = "qr";

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, "");
}

/** `<origin>/tools/<slug>` — the tool page, as a link somebody copies or shares. */
export function toolPageUrl(origin: string, slug: string): string {
  return `${trimOrigin(origin)}/tools/${encodeURIComponent(slug)}`;
}

/**
 * `<origin>/tools/<slug>?src=qr` — what a label encodes. Deliberately the real
 * tool page: no redirect service to keep running, no short link to expire
 * (spec §2). `?src=qr` changes presentation only (`QrArrivalNotice`).
 */
export function toolQrTargetUrl(origin: string, slug: string): string {
  return `${toolPageUrl(origin, slug)}?${QR_SOURCE_PARAM}=${QR_SOURCE_VALUE}`;
}

/**
 * The address as a person reads it under a code: no scheme, no query —
 * `makerlab-ai.vercel.app/tools/form-4`. For somebody whose camera will not scan.
 */
export function displayUrl(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

export const QR_IMAGE_FORMATS = ["svg", "png"] as const;
export type QrImageFormat = (typeof QR_IMAGE_FORMATS)[number];

/** PNG edge in pixels: the route's default and its bounds. */
export const QR_PNG_DEFAULT_PX = 512;
export const QR_PNG_MIN_PX = 128;
export const QR_PNG_MAX_PX = 2048;

/**
 * `/api/qr/<slug>?format=…` — a published tool's code as an image (same
 * origin, so it is relative). `download` asks for an attachment with a file
 * name, which is what the Download links use.
 */
export function qrImagePath(
  slug: string,
  format: QrImageFormat,
  { size, download = false }: { size?: number; download?: boolean } = {}
): string {
  const query = new URLSearchParams({ format });
  if (format === "png" && size) query.set("size", String(size));
  if (download) query.set("download", "1");
  return `/api/qr/${encodeURIComponent(slug)}?${query.toString()}`;
}

/** `form-4-qr.png` — the file a download is saved as. */
export function qrFileName(slug: string, ext: string, kind: "qr" | "label" = "qr"): string {
  const safe = slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "") || "tool";
  return `${safe}-${kind}.${ext}`;
}
