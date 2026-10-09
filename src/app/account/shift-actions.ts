"use server";

import { SHIFTS_SET } from "../../lib/actions/shifts";
import { performAction } from "../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import type { ShiftInput, ShiftResult } from "./shift-result";

/**
 * "On shift" (on-shift spec 2026-10-07): a one-line wrapper over
 * `shifts.set` (`src/lib/actions/shifts.ts`), gated on `shifts.set` by
 * `performAction`. The admin overview and `/account` both use it; it only
 * ever changes the caller's own shift.
 */
export async function setMyShift(input: ShiftInput): Promise<ShiftResult> {
  return performAction(SHIFTS_SET, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
