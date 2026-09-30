/**
 * Notion page and database ids as an admin pastes them (spec §3.8 "Connect",
 * "Mapping").
 *
 * People paste whatever the browser shows: a bare 32-hex id, a dashed uuid, or
 * a `notion.so` / `notion.site` URL whose last path segment is a slug with the
 * id on the end (`/My-Page-0f5e…`), often followed by `?v=<view id>` or
 * `?pvs=4`. The id is always in the path; the query and the hash name a view or
 * a block and are ignored.
 *
 * Returns the id as a dashed lower-case uuid — the form Notion's API returns and
 * the form stored in `notion_mirrors` — or null for anything else. Pure; no
 * imports, so the client and step code can both use it.
 */

const BARE = /^[0-9a-f]{32}$/i;
const DASHED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A 32-hex run at the end of a path segment, not glued to more hex before it. */
const SEGMENT_TAIL = /(?:^|[^0-9a-f])([0-9a-f]{32})$/i;
const SEGMENT_DASHED = /(?:^|[^0-9a-f])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export function parseNotionId(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (BARE.test(value)) return dashed(value);
  if (DASHED.test(value)) return value.toLowerCase();
  return fromUrl(value);
}

function fromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!isNotionHost(url.hostname)) return null;

  let segments: string[];
  try {
    segments = url.pathname.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (!segment) continue;
    const bare = SEGMENT_TAIL.exec(segment);
    if (bare) return dashed(bare[1]);
    const withDashes = SEGMENT_DASHED.exec(segment);
    if (withDashes) return withDashes[1].toLowerCase();
  }
  return null;
}

function isNotionHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "notion.so" ||
    host.endsWith(".notion.so") ||
    host === "notion.site" ||
    host.endsWith(".notion.site")
  );
}

function dashed(hex: string): string {
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
