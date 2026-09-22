"use client";

import { useTranslations } from "next-intl";
import type { AdminActionWarning } from "../../lib/admin/action-result";

/**
 * The one line every admin row control speaks through (spec §6, §4.11).
 *
 * `RoleSelect` established the shape — a single `role="status"` region
 * carrying saving, saved, the warning and the refusal, so a screen reader hears
 * every outcome in the place it heard the last one — and the three queues have
 * one of these per row. Extracted rather than copied a fourth time, because the
 * *order* of these branches is the contract: a warning and an error are never
 * shown together, and "Saved" never appears beside a reason the save did not
 * happen.
 *
 * It renders codes, not sentences. `admin.errors.<code>` and
 * `admin.warnings.<code>` are the shared message families every admin surface
 * looks its refusals up in, so a code added to the gate is translated
 * everywhere at once (Article 6).
 */

export interface RowStatusProps {
  pending: boolean;
  /** True once a change has landed and nothing has qualified it. */
  saved: boolean;
  /** An `admin.errors.<code>` key, or null. */
  error: string | null;
  /** An `admin.warnings.<code>` key, or null. */
  warning: AdminActionWarning | null;
}

export function RowStatus({ pending, saved, error, warning }: RowStatusProps) {
  const t = useTranslations("admin");

  return (
    <span
      className={`admin-row-status${error ? " is-error" : ""}${
        !error && warning ? " is-warning" : ""
      }`}
      role="status"
    >
      {pending ? t("saving") : null}
      {!pending && saved && !error && !warning ? t("saved") : null}
      {!pending && warning ? t(`warnings.${warning}`) : null}
      {!pending && error ? t(`errors.${error}`) : null}
    </span>
  );
}
