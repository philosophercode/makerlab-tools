/**
 * `/kiosk` is a full-bleed screen of its own (kiosk spec §3.1): the root
 * layout's header, status strip, demo banner and chat button are not drawn
 * there. The one test every piece of chrome asks.
 */
export function isKioskPath(pathname: string | null | undefined): boolean {
  return pathname === "/kiosk" || Boolean(pathname?.startsWith("/kiosk/"));
}
