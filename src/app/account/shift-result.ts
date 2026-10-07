import type { AdminActionWarning, AdminGateError } from "../../lib/admin/action-result";

/**
 * What the "On shift" control's server action answers (on-shift spec
 * 2026-10-07). Directive-free, like every surface's result module: a
 * `"use server"` module may export only async functions, and the island
 * renders these codes through `admin.errors.<code>`.
 */

/** The pages that show your own shift: the admin overview and your account. */
export const SHIFT_PATHS = ["/admin", "/account"];

/**
 * Why marking yourself on shift did not land.
 *
 * - `invalid_shift_time` — not a time of day ("HH:MM"), or not the shape the form sends.
 * - `shift_time_passed` — that time has already passed today, in lab time.
 */
export type ShiftError = "invalid_shift_time" | "shift_time_passed";

/** On shift until `endsAt` (ISO), or off shift (`endsAt: null`). */
export type ShiftInput = { onShift: true; until: string } | { onShift: false };

export type ShiftResult =
  | { ok: true; endsAt: string | null; warning?: AdminActionWarning }
  | { ok: false; error: AdminGateError | ShiftError };

export type SetShiftAction = (input: ShiftInput) => Promise<ShiftResult>;
