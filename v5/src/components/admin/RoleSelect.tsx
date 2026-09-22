"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import type { AdminActionError, AdminActionResult } from "../../app/admin/users/action-result";

/**
 * The one interactive control on `/admin/users`: pick a role, and the change
 * lands on that person's next request (spec §5.2, §6).
 *
 * The action arrives as a **prop** rather than being imported here. Two reasons,
 * and the second is the one that matters: a client component importing
 * `actions.ts` would drag `next/headers`, the rate limiter and `server-only`
 * into this module's graph, which makes it untestable without a Next runtime —
 * and the page that renders this is a server component that already has the
 * action to hand. `UsersTable` passes it down.
 *
 * **Disabling is presentation.** `disabledReason` explains a row the page
 * already knows cannot change — the super-admin floor, the last super admin —
 * but the server action checks both again, because a select that is disabled in
 * the DOM is disabled for exactly as long as nobody opens the console (§8).
 */

export interface RoleSelectProps {
  userId: string;
  /** Whose role this is — for the control's accessible name. */
  personName: string;
  role: Role;
  /** Why this row cannot change, or null when it can. */
  disabledReason?: AdminActionError | null;
  /** The `setUserRole` server action, passed down by the page. */
  action: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
}

export function RoleSelect({
  userId,
  personName,
  role,
  disabledReason = null,
  action,
}: RoleSelectProps) {
  const t = useTranslations("admin");
  const [pending, setPending] = useState(false);
  // The select is controlled from here rather than from the row's props, so it
  // shows what was chosen while the action is in flight. On a refusal it snaps
  // back to what the server still holds — never leaving the page asserting a
  // change that did not happen (Article 4).
  const [current, setCurrent] = useState<Role>(role);
  const [error, setError] = useState<AdminActionError | null>(null);
  const [saved, setSaved] = useState(false);

  /**
   * Deliberately **not** wrapped in `useTransition`.
   *
   * The action ends with `revalidatePath`, so a transition's pending state
   * covers the write *and* the server re-render that follows it — which means
   * the control sits on "Saving…" until a whole page has been rendered again.
   * Under load that is seconds, and it made a genuine save look stuck. What
   * the person needs confirmed is that the change landed, which is exactly
   * what the awaited result says. The revalidation still happens; it just no
   * longer holds the confirmation hostage.
   */
  async function handleChange(next: string) {
    const previous = current;
    setCurrent(next as Role);
    setError(null);
    setSaved(false);
    setPending(true);

    try {
      const result = await action({ userId, role: next });
      if (result.ok) {
        setSaved(true);
        return;
      }
      setCurrent(previous);
      setError(result.error);
    } catch {
      // A server action that never answered — a dropped connection, a redeploy
      // mid-click. The row goes back to what the server last confirmed.
      setCurrent(previous);
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  const locked = Boolean(disabledReason);
  const note = error ?? disabledReason;

  return (
    <div className="admin-role-select">
      <label className="admin-visually-hidden" htmlFor={`role-${userId}`}>
        {t("roleForPerson", { name: personName })}
      </label>
      <select
        id={`role-${userId}`}
        value={current}
        disabled={locked || pending}
        onChange={(event) => void handleChange(event.target.value)}
      >
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {t(`roles.${option}`)}
          </option>
        ))}
      </select>
      {/* One live region for every outcome this control can have, so a screen
          reader hears the refusal in the same place it heard the confirmation. */}
      <span
        className={`admin-row-status${error ? " is-error" : ""}`}
        role="status"
      >
        {pending ? t("saving") : null}
        {!pending && saved && !error ? t("saved") : null}
        {!pending && note ? t(`errors.${note}`) : null}
      </span>
    </div>
  );
}
