/**
 * The public origin link previews resolve against (`metadataBase`).
 *
 * A crawler (WhatsApp, iMessage, Slack, LinkedIn, X) only follows absolute
 * `og:image` / `og:url` values, so every relative one in the metadata is
 * resolved against this. `NEXT_PUBLIC_SITE_URL` names it outright (a custom
 * domain); on Vercel the project's production domain is used, previews
 * included, so a preview's card points at images that exist in production;
 * anywhere else, the live deployment.
 */
export const DEFAULT_SITE_URL = "https://makerlab-ai.vercel.app";

export function siteUrl(env: Record<string, string | undefined> = process.env): URL {
  const explicit = (env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (explicit) {
    const parsed = parseOrigin(explicit);
    if (parsed) return parsed;
  }
  const production = (env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
  if (production) {
    const parsed = parseOrigin(/^https?:\/\//.test(production) ? production : `https://${production}`);
    if (parsed) return parsed;
  }
  return new URL(DEFAULT_SITE_URL);
}

function parseOrigin(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}
