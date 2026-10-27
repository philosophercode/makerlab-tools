import { lab } from "./lab/config.ts";

/**
 * Site-wide configuration for white-labeling.
 * Every field comes from the lab config (`lab/lab.config.ts`, lab config spec
 * 2026-10-25), and the environment variable that named it before still
 * overrides it, so one checkout can serve several deployments.
 *
 * Note: values referenced in client components must come from `NEXT_PUBLIC_*`
 * vars (inlined at build time). `audience` is only used server-side in the
 * chat system prompt, so it stays private (`AUDIENCE`).
 */
export interface SiteConfig {
  /** Display name shown in headers and titles. */
  name: string;
  /** Institution or organization name. */
  institution: string;
  /** Tagline shown in the brand lockup / metadata. */
  tagline: string;
  /** Name for the AI chat assistant. */
  chatAssistantName: string;
  /** Audience description used in the AI system prompt (server-only). */
  audience: string;
  /**
   * Path to the institution's official logo in /public: one colour, vector
   * (`brand.logo` in the lab config). `BrandLogo` draws it as a mask in the text colour (the
   * kiosk, the footer, About), so one file reads dark on light and light on
   * dark.
   */
  logo: string;
  /**
   * The same logo as a PNG, for what cannot draw an SVG: the QR label sheets
   * (`pdf-lib` embeds PNG), the link-preview card, email. An SVG logo's PNG
   * sits beside it under the same name (`pngTwin`); a PNG logo is its own.
   */
  logoPng: string;
  /**
   * Path to the wordmark alone in /public (`brand.wordmark`), shown as a mask
   * in the site header so it takes the theme's text colour: the header reads
   * this mark plus "AI" (owner decision, 2026-10-07).
   */
  wordmark: string;
  /**
   * The lab's opening hours as one line of text, shown in the header's status
   * strip and on the kiosk screen (`/kiosk`). Free text until hours are
   * structured (kiosk spec phase 2); `NEXT_PUBLIC_LAB_HOURS` overrides it.
   */
  labHours: string;
  /**
   * The public repository this deployment's code comes from, linked from the
   * footer, `/product` and About (identity spec amendment "Source code and
   * forking", 2026-10-21). A fork sets `NEXT_PUBLIC_SOURCE_URL` to its own
   * repository: that link is how a modified network deployment offers its
   * source under the AGPL-3.0 (§13, `docs/legal/LICENSING.md`).
   */
  sourceUrl: string;
  /** Brand colors — injected as CSS variables at the root layout. */
  colors: {
    primary: string;
    primaryDark: string;
  };
}

/** An SVG's PNG twin: the same path ending in `.png`. Any other file is its own. */
export function pngTwin(path: string): string {
  return path.replace(/\.svg$/i, ".png");
}

const LOGO = process.env.NEXT_PUBLIC_LOGO ?? lab.brand.logo;

export const siteConfig: SiteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? lab.identity.siteName,
  institution: process.env.NEXT_PUBLIC_INSTITUTION ?? lab.identity.institution,
  tagline: process.env.NEXT_PUBLIC_TAGLINE ?? lab.identity.tagline,
  chatAssistantName: process.env.NEXT_PUBLIC_CHAT_ASSISTANT_NAME ?? lab.identity.assistantName,
  audience: process.env.AUDIENCE ?? lab.identity.audience,
  logo: LOGO,
  logoPng: pngTwin(LOGO),
  wordmark: process.env.NEXT_PUBLIC_WORDMARK ?? lab.brand.wordmark,
  labHours: process.env.NEXT_PUBLIC_LAB_HOURS || lab.place.hours,
  sourceUrl: process.env.NEXT_PUBLIC_SOURCE_URL || lab.web.sourceUrl,
  colors: {
    primary: process.env.NEXT_PUBLIC_COLOR_PRIMARY ?? lab.brand.colors.primary,
    primaryDark: process.env.NEXT_PUBLIC_COLOR_PRIMARY_DARK ?? lab.brand.colors.primaryDark,
  },
};
