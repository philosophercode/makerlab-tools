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
 * Names one unit of the tool on a unit's own label (QR codes spec amendment
 * 2026-10-06, "Unit labels"). Like `src`, it changes presentation only: the
 * tool page already lists every unit, and the parameter picks which one the
 * arrival notice names and reports against.
 */
export const QR_UNIT_PARAM = "unit";

/**
 * Hex characters of a unit's id that a label carries. The first eight of a
 * uuid are unique among one tool's handful of units (a clash is about one in
 * four billion per pair), and they keep the code small: a full uuid would add
 * 28 characters and two QR versions, so smaller modules on a sticker that
 * gets scuffed. A token that matches no unit, or two, names none.
 */
export const UNIT_TOKEN_LENGTH = 8;

/** The token a unit's label carries: its id's first eight hex characters. */
export function unitQrToken(unitId: string): string {
  return unitId.replace(/[^0-9a-f]/gi, "").slice(0, UNIT_TOKEN_LENGTH).toLowerCase();
}

/**
 * `<origin>/tools/<slug>?src=qr&unit=<token>` — what a unit's label encodes:
 * the same tool page as the tool's label, with the unit named. No new route,
 * so a unit label keeps working wherever the tool label does.
 */
export function unitQrTargetUrl(origin: string, slug: string, unitId: string): string {
  return `${toolQrTargetUrl(origin, slug)}&${QR_UNIT_PARAM}=${unitQrToken(unitId)}`;
}

/**
 * A `?unit=` value as a token, or null for anything else. Accepts the
 * eight-character token and anything longer up to a whole uuid (with or
 * without dashes), so a hand-made link with the full id works too.
 */
export function parseUnitToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim().replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{8,32}$/.test(token) ? token : null;
}

/**
 * The one unit of `units` whose id starts with `token`, or null when none or
 * more than one does. Resolved only among the tool's own units, never across
 * the catalogue.
 */
export function unitForToken<T extends { id: string }>(units: readonly T[], token: string | null): T | null {
  if (!token) return null;
  const matches = units.filter((unit) => unit.id.replace(/-/g, "").toLowerCase().startsWith(token));
  return matches.length === 1 ? matches[0] : null;
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
