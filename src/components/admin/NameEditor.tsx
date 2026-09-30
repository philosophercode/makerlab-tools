"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { PERSON_NAME_MAX_LENGTH, type SetNameAction } from "../../app/admin/users/action-result";
import { InlineTextEditor } from "../system/InlineTextEditor";

/**
 * **Edit name** on `/admin/users`: a person's display name in the Person
 * column, with the same pencil and inline field as their title
 * (`InlineTextEditor`). A super admin may rename anybody — including somebody
 * added who has not signed in yet, whose name is still their address. The
 * `setUserName` action trims, refuses blank or over-long, and records
 * `user.name_changed`; a name set here is never overwritten by Google later.
 *
 * `display` is the caller's, because the Person cell draws a placeholder name
 * (the address) differently from a real one.
 */

export interface NameEditorProps {
  userId: string;
  /** The stored name — the address, for somebody added without one. */
  name: string;
  /** How the name reads in its cell. */
  display: (name: string) => ReactNode;
  /** The `setUserName` server action, passed down by the page. */
  action: SetNameAction;
}

export function NameEditor({ userId, name, display, action }: NameEditorProps) {
  const t = useTranslations("admin");

  return (
    <InlineTextEditor
      value={name}
      display={(stored) => display(stored ?? name)}
      editLabel={t("personName.editFor", { name })}
      editTooltip={t("personName.edit")}
      inputLabel={t("personName.label", { name })}
      hint={t("personName.hint", { max: PERSON_NAME_MAX_LENGTH })}
      maxLength={PERSON_NAME_MAX_LENGTH}
      save={async (draft) => {
        const result = await action({ userId, name: draft });
        return result.ok ? { ok: true, value: result.name, warning: result.warning } : result;
      }}
      describe={(code) => ("error" in code ? t(`errors.${code.error}`) : t(`warnings.${code.warning}`))}
    />
  );
}
