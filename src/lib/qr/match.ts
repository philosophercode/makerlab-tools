import { DEFAULT_SITE_URL, qrSiteUrl } from "./site-url.ts";

/**
 * What a QR code read out of a photo points at (QR labels amendment, "codes in
 * chat photos"). A decoded payload is untrusted text off a sticker anybody
 * could print: this only ever answers "one of our tool pages, with this
 * id/slug", "one of our pages that is not a tool", "somewhere else" or
 * "not a link" — never the payload itself, which must not reach a prompt.
 *
 * Pure: the hosts come in as an argument (`ourQrHosts()` from the environment).
 */

export type QrTarget =
  /** `/tools/<segment>` on one of our hosts — a slug, a tool id or a legacy Notion page id. */
  | { kind: "tool"; idOrSlug: string }
  /** One of our hosts, not a tool page. */
  | { kind: "site" }
  /** A link somewhere else. */
  | { kind: "external" }
  /** Not a web link at all (text, Wi-Fi, vCard…). */
  | { kind: "other" };

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * The hosts a code of ours can name: the configured site (`qrSiteUrl`, the
 * same origin every label encodes), Vercel's production domain, and the live
 * deployment's own address — so a label printed before a domain change still
 * resolves.
 */
export function ourQrHosts(env: Record<string, string | undefined> = process.env): string[] {
  const hosts = [qrSiteUrl(env), DEFAULT_SITE_URL, env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ""]
    .map((url) => (url ? hostOf(url.includes("://") ? url : `https://${url}`) : null))
    .filter((host): host is string => Boolean(host));
  return Array.from(new Set(hosts));
}

/** A tool page segment: a slug, a uuid or a Notion id — letters, digits and dashes, bounded. */
const SEGMENT = /^[a-z0-9][a-z0-9-]{0,119}$/i;

export function qrTarget(payload: string, hosts: readonly string[]): QrTarget {
  const text = payload.trim();
  if (!/^https?:\/\//i.test(text)) return { kind: "other" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "other" };
  }
  if (!hosts.includes(url.host.toLowerCase())) return { kind: "external" };
  const match = /^\/tools\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return { kind: "site" };
  let segment: string;
  try {
    segment = decodeURIComponent(match[1]);
  } catch {
    return { kind: "site" };
  }
  return SEGMENT.test(segment) ? { kind: "tool", idOrSlug: segment } : { kind: "site" };
}
