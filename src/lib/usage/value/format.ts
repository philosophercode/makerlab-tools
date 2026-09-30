/**
 * How the value report writes its numbers — on the page, in print and in the
 * CSV alike, so the three never disagree by a rounding. US English and US
 * dollars: the report is written for a US dean (the lab's subscription is in
 * dollars). Pure.
 */

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const dollarsExact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

export function formatCount(n: number): string {
  return integer.format(n);
}

/** Hours to one decimal: 12.3. */
export function formatHours(n: number): string {
  return oneDecimal.format(n);
}

/** Whole dollars: $1,234. */
export function formatMoney(n: number): string {
  return dollars.format(n);
}

/** An assumption as the lab typed it: $40, $42.50. */
export function formatRate(n: number): string {
  return Number.isInteger(n) ? dollars.format(n) : dollarsExact.format(n);
}

/** A share (0–1) as a whole percent, or null for none. */
export function formatPercent(share: number | null): string | null {
  return share === null ? null : `${Math.round(share * 100)}%`;
}

/** An hour of the day, 0–24: "8 AM", "12 PM", "8 PM", "12 AM". */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "AM" : "PM";
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${suffix}`;
}

/** A lab date (`YYYY-MM-DD`) as "Aug 21, 2026". */
export function formatLabDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return longDate.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Minutes as the lab typed them: 4, 2.5. */
export function formatMinutes(n: number): string {
  return Number.isInteger(n) ? String(n) : oneDecimal.format(n);
}
