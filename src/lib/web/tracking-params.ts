/**
 * Tracking parameters off a stored link (manual text spec amendment
 * 2026-09-28): `?utm_source=chatgpt.com` and its kind say where a click came
 * from, never what the page is, and a link stored with one is a different key
 * to the archive, the manual search and every "is this the same link?" check
 * — the Bambu X1-Carbon quick-start guide was stored twice, once with it.
 *
 * Removed: every `utm_*`, the ad networks' click ids (`gclid`, `fbclid`,
 * `msclkid` …), the mailers' (`mc_cid`, `_hsenc` …), and the share tokens
 * YouTube and Spotify add (`si`, only on their hosts — elsewhere `si` can be a
 * real parameter). Everything else, the fragment included, is kept, in order.
 * A string that is not an http(s) URL comes back unchanged.
 *
 * Pure, no imports: research steps, the data layer and the backfill share it.
 */

const EXACT = new Set([
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "yclid",
  "twclid",
  "ttclid",
  "li_fat_id",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "_hsenc",
  "_hsmi",
  "hsctatracking",
  "mkt_tok",
  "srsltid",
  "ref_src",
  "oly_anon_id",
  "oly_enc_id",
  "vero_id",
  "wickedid",
  "rb_clickid",
]);

const SHARE_TOKEN_HOSTS = /(^|\.)(youtube\.com|youtu\.be|spotify\.com)$/i;

function isTracking(name: string, host: string): boolean {
  const key = name.toLowerCase();
  if (key.startsWith("utm_")) return true;
  if (EXACT.has(key)) return true;
  return key === "si" && SHARE_TOKEN_HOSTS.test(host);
}

/** The URL without tracking parameters; anything that is not an http(s) URL, unchanged. */
export function stripTrackingParams(raw: string): string {
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return raw;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return raw;
  if (!url.search) return trimmed;
  const kept = [...url.searchParams].filter(([name]) => !isTracking(name, url.hostname));
  if (kept.length === [...url.searchParams].length) return trimmed;
  // Rebuilt by hand so the kept parameters keep their original spelling.
  const pairs = url.search
    .slice(1)
    .split("&")
    .filter((pair) => {
      const name = decodeSafe(pair.split("=")[0] ?? "");
      return name !== "" && !isTracking(name, url.hostname);
    });
  url.search = pairs.length > 0 ? `?${pairs.join("&")}` : "";
  return url.toString();
}

/** A nullable link, cleaned; null stays null. */
export function cleanLink<T extends string | null | undefined>(value: T): T {
  return (typeof value === "string" ? stripTrackingParams(value) : value) as T;
}

function decodeSafe(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}
