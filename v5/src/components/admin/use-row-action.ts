"use client";

import { useState } from "react";
import type { AdminActionWarning } from "../../lib/admin/action-result";

/**
 * What every queue control does around its server action (spec §6, Article 4).
 *
 * The three queues each show one row per thing and change it in place, so each
 * of their controls needs the same four states and the same discipline about
 * them — the discipline `RoleSelect` wrote down first:
 *
 * - **The control is optimistic**, so the value moves the moment it is clicked
 *   rather than after a round trip. A queue somebody has ten minutes for cannot
 *   spend one of them watching selects.
 * - **A refusal restores the previous value.** The server declined and nothing
 *   changed, so leaving the new value on screen would have the page asserting a
 *   state the database does not hold.
 * - **A warning keeps the new value.** The change *did* land; something
 *   secondary did not (§4.11). Restoring here would be the same lie in the
 *   other direction.
 * - **A rejected promise is `failed`** — a dropped connection, a redeploy
 *   mid-click. The row goes back to what the server last confirmed.
 *
 * **Deliberately no `useTransition`.** Every one of these actions ends in
 * `revalidatePath`, and a transition's pending state covers the write *and* the
 * server re-render behind it, which made a landed save look stuck under load.
 * What the person needs confirmed is that the change happened, which is exactly
 * what the awaited result says; the revalidation still happens, it just no
 * longer holds the confirmation hostage.
 */

/** What a queue action answers, as much of it as this hook cares about. */
export type RowActionResult =
  | { ok: true; warning?: AdminActionWarning }
  | { ok: false; error: string };

export interface RowAction<T> {
  /** What to show: the optimistic value while in flight, the truth otherwise. */
  value: T;
  pending: boolean;
  saved: boolean;
  /** An `admin.errors.<code>` key, or null. */
  error: string | null;
  warning: AdminActionWarning | null;
  /**
   * Move to `next`, call the action, and settle on whichever it turns out to
   * be. Answers whether the change landed, for a control that has something of
   * its own to reconcile — a text draft it should now consider committed.
   */
  run: (next: T, call: () => Promise<RowActionResult>) => Promise<boolean>;
}

export function useRowAction<T>(initial: T): RowAction<T> {
  const [value, setValue] = useState<T>(initial);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<AdminActionWarning | null>(null);

  async function run(next: T, call: () => Promise<RowActionResult>): Promise<boolean> {
    const previous = value;
    setValue(next);
    setError(null);
    setWarning(null);
    setSaved(false);
    setPending(true);

    try {
      const result = await call();
      if (result.ok) {
        setSaved(true);
        setWarning(result.warning ?? null);
        return true;
      }
      setValue(previous);
      setError(result.error);
      return false;
    } catch {
      setValue(previous);
      setError("failed");
      return false;
    } finally {
      setPending(false);
    }
  }

  return { value, pending, saved, error, warning, run };
}
