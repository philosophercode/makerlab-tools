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
  /**
   * Path to the institution's official logo in /public: one colour, vector
   * (the Cornell Tech MakerLAB lockup: the Cornell seal, "CORNELL TECH",
   * "MakerLAB"). `BrandLogo` draws it as a mask in the text colour (the
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
   * Path to the wordmark alone in /public ("MakerLAB"), shown as a mask in the
   * site header so it takes the theme's text colour. The lettering cropped
   * from the official Cornell Tech MakerLAB lockup (owner decision,
   * 2026-10-07: the header reads "MakerLAB AI", this mark plus "AI").
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

/** An SVG's PNG twin: the same path ending in `.png`. Any other file is its own. */
export function pngTwin(path: string): string {
  return path.replace(/\.svg$/i, ".png");
}

const LOGO = process.env.NEXT_PUBLIC_LOGO ?? "/brand/cornell-tech-makerlab-logo.svg";

export const siteConfig: SiteConfig = {
  name: process.env.NEXT_PUBLIC_SITE_NAME ?? "MakerLAB Tools",
  institution: process.env.NEXT_PUBLIC_INSTITUTION ?? "Cornell Tech",
  tagline:
    process.env.NEXT_PUBLIC_TAGLINE ??
    "Your digital guide to making at Cornell Tech",
  chatAssistantName:
    process.env.NEXT_PUBLIC_CHAT_ASSISTANT_NAME ?? "MakerLAB AI",
  audience: process.env.AUDIENCE ?? "students who may be beginners",
  logo: LOGO,
  logoPng: pngTwin(LOGO),
  wordmark: process.env.NEXT_PUBLIC_WORDMARK ?? "/brand/makerlab-wordmark-official.svg",
  labHours: process.env.NEXT_PUBLIC_LAB_HOURS || "LAB OPEN 8AM-8PM",
  colors: {
    primary: process.env.NEXT_PUBLIC_COLOR_PRIMARY ?? "#ff6b35",
    primaryDark: process.env.NEXT_PUBLIC_COLOR_PRIMARY_DARK ?? "#cc4f1f",
  },
};
