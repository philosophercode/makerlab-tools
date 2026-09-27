import type { ActionPreview } from "./define";

/**
 * Has the subject moved on since the card was drawn? (assistant–GUI parity
 * spec §3.3 step 4, §5.5.)
 *
 * A proposal lives up to an hour in the chat, so the card's "before" can be
 * an hour old. The GUI's last-write-wins rule assumed a fresh screen; a stored
 * card is not one. So at the click the definition's own `preview` is read
 * again, and every field the card shows is compared: if what the card called
 * "now" is no longer the value, the change is not applied and the card shows
 * the value it would have overwritten.
 *
 * Field by field, so only what the card changes counts: someone assigning a
 * ticket does not stop another person's card that only closes it. A field the
 * card creates (`before: null` on a new record) is compared the same way, and
 * stays null.
 */

/** One field whose value changed between the card and the click. */
export interface DriftedField {
  field: string;
  /** What the card said the value was. */
  was: string | null;
  /** What it is now. */
  now: string | null;
  format?: ActionPreview["rows"][number]["format"];
}

/**
 * The fields of `stored` whose `before` no longer matches `fresh`. A `fresh`
 * of null (the subject is gone) answers none: the action's own `check`/`run`
 * already answers that with its not-found code.
 */
export function driftedFields(stored: ActionPreview, fresh: ActionPreview | null): DriftedField[] {
  if (!fresh) return [];
  const current = new Map(fresh.rows.map((row) => [row.field, row]));
  const drifted: DriftedField[] = [];
  for (const row of stored.rows ?? []) {
    const now = current.get(row.field);
    const nowValue = now ? now.before : null;
    if ((row.before ?? null) !== (nowValue ?? null)) {
      drifted.push({ field: row.field, was: row.before ?? null, now: nowValue ?? null, ...(row.format ? { format: row.format } : {}) });
    }
  }
  return drifted;
}
