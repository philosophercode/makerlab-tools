/**
 * The query parameters the kiosk's QR code carries (kiosk spec §5.4), shared
 * by the server that encodes them and the client that reads them. Both are
 * presentation only — never a change to what data a page shows — the same
 * rule as the machine labels' `?src=qr`.
 */

export const KIOSK_SOURCE_PARAM = "src";
export const KIOSK_SOURCE_VALUE = "kiosk";
/** `ask=1` opens the assistant on arrival. */
export const ASK_PARAM = "ask";

/** `<origin>/?src=kiosk&ask=1` — what the QR code encodes. No identifier of any kind. */
export function kioskAskUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/?${KIOSK_SOURCE_PARAM}=${KIOSK_SOURCE_VALUE}&${ASK_PARAM}=1`;
}
