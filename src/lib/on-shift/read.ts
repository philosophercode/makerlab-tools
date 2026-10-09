import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import { evaluateUser } from "../auth/identity";
import { can } from "../auth/permissions";
import { ON_SHIFT_CACHE } from "../cache";
import { listCurrentShifts } from "../data/staff-shifts";
import { ON_SHIFT_TAG } from "../revalidate";
import { visibleOnShift, type ShiftRow } from "./names";

/**
 * Who is on shift, as every public surface reads it (on-shift spec
 * 2026-10-07 §5.3): the home page, a tool page, the kiosk and the chat.
 *
 * {@link getShiftRoster} is cached under `on-shift` (`ON_SHIFT_CACHE`), so a
 * page view costs a cache read, not a query; marking yourself on or off shift
 * clears the tag. It answers each shift with its end time and whether the
 * person may appear (the account resolves exactly as a sign-in would, floor
 * and ban included, and its role holds `shifts.set`). The full name and the
 * address stay in here: what leaves is the short name.
 *
 * {@link loadOnShiftNames} drops the shifts that have ended **outside** the
 * cache, against the request's clock, so a cached roster can never keep
 * somebody on shift past the time they picked.
 */

export interface RosterEntry extends ShiftRow {
  endsAt: string;
}

export async function getShiftRoster(): Promise<RosterEntry[]> {
  "use cache";
  cacheTag(ON_SHIFT_TAG);
  cacheLife(ON_SHIFT_CACHE);

  const rows = await listCurrentShifts();
  return rows.map((row) => {
    const verdict = evaluateUser({ id: row.userId, email: row.email, role: row.role, banned: row.banned });
    return {
      name: row.name,
      endsAt: row.endsAt,
      eligible: verdict.ok && can({ role: verdict.role }, "shifts.set"),
    };
  });
}

/**
 * The names on shift at `now` ("Alex M."), or an empty list. A read that fails
 * is an empty list and a log line: a page or a chat answer never fails over
 * this line, and nobody is ever named who was not read (Article 4). The catch
 * sits outside the cached read, so a failure is never cached.
 */
export async function loadOnShiftNames(now: Date = new Date()): Promise<string[]> {
  try {
    return visibleOnShift(await getShiftRoster(), now);
  } catch (err) {
    console.error("[on-shift] could not read who is on shift", err);
    return [];
  }
}
