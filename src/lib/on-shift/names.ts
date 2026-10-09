import { shortAuthorName } from "../kiosk/derive.ts";
import { isShiftOn } from "./time.ts";

/**
 * Who students see on shift (on-shift spec 2026-10-07 §5.3), decided once.
 *
 * A shift is shown only when all of these hold:
 *
 * - **It has not ended.** `ends_at` is after `now`. Nothing sweeps old rows;
 *   this check is what makes a shift end by itself.
 * - **The person may hold a shift.** The caller passes `eligible`: the
 *   account resolves (not banned, in the domain) and its role holds
 *   `shifts.set`. Somebody demoted after marking themselves disappears.
 * - **There is a real name to show.** First name and last initial, the rule
 *   the kiosk uses for project authors (`shortAuthorName`): "Alex Morgan"
 *   becomes "Alex M.". A placeholder name (the address, which Add person
 *   stores when nobody typed a name) has no name in it, so that person is
 *   not shown rather than shown as something invented.
 *
 * Nobody on shift is an empty list, and every surface then shows nothing at
 * all: never a stand-in name, never "0 on shift".
 *
 * Pure: the read (`read.ts`) and the tests hand it rows and a clock.
 */

export interface ShiftRow {
  name: string | null;
  endsAt: Date | string;
  /** Whether this person may appear: resolves, and holds `shifts.set`. */
  eligible: boolean;
}

/** The person as students see them, or null when there is no name to show. */
export function shiftDisplayName(name: string | null | undefined): string | null {
  return shortAuthorName(name);
}

/** The names on shift at `now`, each once, in alphabetical order. */
export function visibleOnShift(rows: readonly ShiftRow[], now: Date = new Date()): string[] {
  const names = new Set<string>();
  for (const row of rows) {
    if (!row.eligible || !isShiftOn(row.endsAt, now)) continue;
    const display = shiftDisplayName(row.name);
    if (display) names.add(display);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
