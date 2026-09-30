/**
 * The public origin a printed code points at. A label outlives any preview
 * deployment and any laptop, so this is the production site, never the
 * request's own host: `NEXT_PUBLIC_SITE_URL`, else Vercel's production domain
 * (`VERCEL_PROJECT_PRODUCTION_URL`, set on previews too), else the live
 * deployment's address.
 *
 * Server-side (it reads `VERCEL_PROJECT_PRODUCTION_URL`, which the browser
 * never sees): pages compute it and hand the resulting URLs down.
 */
export const DEFAULT_SITE_URL = "https://makerlab-ai.vercel.app";

export function qrSiteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const production = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return DEFAULT_SITE_URL;
}
