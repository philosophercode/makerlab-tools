/**
 * Site-wide configuration for white-labeling.
 * Every field is env-driven with a sensible default, so the app can be
 * rebranded for any institution without code changes.
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
  /** Path to the logo image in /public (the full lockup, e.g. "MakerLAB@CORNELL TECH"). */
  logo: string;
  /**
   * Path to the wordmark alone in /public ("MakerLAB"), shown as a mask in the
   * site header so it takes the theme's text colour. Cropped from `logo`.
   */
  wordmark: string;
  /**
   * The lab's opening hours as one line of text, shown in the header's status
   * strip and on the kiosk screen (`/kiosk`). Free text until hours are
   * structured (kiosk spec phase 2); `NEXT_PUBLIC_LAB_HOURS` overrides it.
   */
  labHours: string;
  /** Brand colors — injected as CSS variables at the root layout. */
  colors: {
    primary: string;
    primaryDark: string;
  };
}

export const siteConfig: SiteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "MakerLAB Tools",
  institution: process.env.NEXT_PUBLIC_INSTITUTION ?? "Cornell Tech",
  tagline:
    process.env.NEXT_PUBLIC_TAGLINE ??
    "Your digital guide to making at Cornell Tech",
  chatAssistantName:
    process.env.NEXT_PUBLIC_CHAT_ASSISTANT_NAME ?? "MakerLAB AI",
  audience: process.env.AUDIENCE ?? "students who may be beginners",
  logo: process.env.NEXT_PUBLIC_LOGO ?? "/makerlab-logo-transparent.png",
  wordmark: process.env.NEXT_PUBLIC_WORDMARK ?? "/makerlab-wordmark.png",
  labHours: process.env.NEXT_PUBLIC_LAB_HOURS || "LAB OPEN 8AM-8PM",
  colors: {
    primary: process.env.NEXT_PUBLIC_COLOR_PRIMARY ?? "#ff6b35",
    primaryDark: process.env.NEXT_PUBLIC_COLOR_PRIMARY_DARK ?? "#cc4f1f",
  },
};
