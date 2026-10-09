import { siteConfig } from "../lib/site-config";
import { cn } from "../lib/utils";

/**
 * The institution's official logo (`siteConfig.logo`, the Cornell Tech
 * MakerLAB lockup), drawn as a CSS mask filled with the text colour: dark on
 * the light theme, light on the dark one and on the kiosk, from one file.
 * The caller sets the height (`className`); the width follows at the
 * lockup's own proportions (`.brand-logo` in globals.css).
 *
 * Decoration: every place it appears also names the lab in words (the kiosk's
 * heading, the footer's line, About's title), so it is hidden from assistive
 * technology rather than read twice.
 *
 * Not the header: the header keeps the MakerLAB wordmark (`siteConfig.wordmark`,
 * owner decision 2026-10-06).
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-slot="brand-logo"
      className={cn("brand-logo", className)}
      style={{ maskImage: `url(${siteConfig.logo})`, WebkitMaskImage: `url(${siteConfig.logo})` }}
    />
  );
}
