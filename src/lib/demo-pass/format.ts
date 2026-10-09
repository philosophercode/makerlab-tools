/**
 * A demo pass's money and dates as a visitor reads them, in their locale
 * (demo pass spec 2026-10-07 §6). Pure and client-safe.
 */

/** `$0.42` — dollars, two decimals, rounded down so "left" is never more than there is. */
export function formatUsd(value: number, locale: string): string {
  const cents = Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * 100 + 1e-9)) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents);
  } catch {
    return `$${cents.toFixed(2)}`;
  }
}

/** `Oct 21, 2026` — the day a pass ends, in the reader's locale. */
export function formatPassDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}
