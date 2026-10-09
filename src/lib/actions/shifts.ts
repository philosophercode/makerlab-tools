import "server-only";

import { z } from "zod";
import { SHIFT_PATHS, type ShiftError, type ShiftInput } from "../../app/account/shift-result";
import { endShift, startShift } from "../data/staff-shifts";
import { labTimeToday, SHIFT_TIME_PATTERN } from "../on-shift/time";
import { invalidateOnShift } from "../revalidate";
import { defineAction } from "./define";

/**
 * "On shift" (on-shift spec 2026-10-07): a staff member marks **themselves**
 * on shift until a time they pick today, in lab time, or ends their shift
 * now. Students then see "On shift now: Alex M." on the home page, tool pages
 * and the kiosk, and MakerLAB AI may suggest asking them.
 *
 * - **Only yourself.** The input names no person; the row is always the
 *   caller's (`ctx.identity.userId`). Nobody puts somebody else on shift.
 * - **Gated on `shifts.set`**, which SuperMakers and directors hold.
 * - **GUI only** (`assistant: "never"`, so MCP never either): appearing to
 *   students is the person's own choice, made by the person on the admin
 *   overview or their account page, not something an assistant proposes.
 * - **The end is in the future.** "18:00" is today in `LAB_TIMEZONE`; a time
 *   that has already passed is refused (`shift_time_passed`) rather than
 *   moved to tomorrow, which nobody asked for.
 *
 * No audit event, like the lab notes: the row is state, short-lived, and
 * says whose it is. Every change clears the `on-shift` cache tag, so the
 * next page view and chat turn have it.
 */
const NEVER_REASON =
  "Appearing to students as on shift is a person's own choice; staff mark themselves on the admin overview or their account page";

const shiftInputSchema: z.ZodType<ShiftInput> = z.union([
  z.object({ onShift: z.literal(true), until: z.string().regex(SHIFT_TIME_PATTERN) }).strict(),
  z.object({ onShift: z.literal(false) }).strict(),
]);

export const SHIFTS_SET = defineAction<ShiftInput, { endsAt: string | null }, ShiftError>({
  id: "shifts.set",
  toolName: "set_my_shift",
  description: "Mark yourself on shift until a time today, in lab time, or end your shift now.",
  permission: "shifts.set",
  risk: "operational",
  assistant: "never",
  neverReason: NEVER_REASON,
  input: shiftInputSchema,
  invalidInput: "invalid_shift_time",
  // The caller, always: the input cannot name anybody.
  subject: () => ({ type: "user", id: "self" }),
  run: async (input, ctx) => {
    const userId = ctx.identity.userId;
    if (!userId) return { ok: false, error: "not_signed_in" };
    if (!input.onShift) {
      const { ended } = await endShift(userId);
      return { ok: true, value: { endsAt: null }, ...(ended ? { committed: true } : {}) };
    }
    const now = new Date();
    const endsAt = labTimeToday(input.until, now);
    if (!endsAt) return { ok: false, error: "invalid_shift_time" };
    if (endsAt.getTime() <= now.getTime()) return { ok: false, error: "shift_time_passed" };
    await startShift(userId, endsAt);
    return { ok: true, value: { endsAt: endsAt.toISOString() }, committed: true };
  },
  afterCommit: async () => {
    invalidateOnShift();
    return undefined;
  },
  revalidate: SHIFT_PATHS,
});
