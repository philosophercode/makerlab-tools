import { APPLE_ICON_SIZE, renderAppleIcon } from "../lib/share/site-card";

/** The iOS home-screen and iMessage icon, 180×180; `icon.svg` stays the favicon. */
export const size = APPLE_ICON_SIZE;
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppleIcon();
}
