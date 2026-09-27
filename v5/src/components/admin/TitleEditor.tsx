"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Role } from "../../lib/db/schema/vocabulary";
import { displayTitle, USER_TITLE_MAX_LENGTH } from "../../lib/people/title";
import type { SetTitleAction } from "../../app/admin/users/action-result";
import { InlineTextEditor } from "../system/InlineTextEditor";

/**
 * A person's title in the Title column of `/admin/users`, and the inline
 * control that changes it — `InlineTextEditor` with the title's words.
 *
 * Read, it is the title `displayTitle` derives: the custom one (in ink), else
 * the role's default (`admin.titles.<role>`, muted — it is a fallback, not a
 * choice anybody made). The pencil ("Edit the title for <name>") opens a
 * field; a blank save clears the custom title, and the placeholder says which
 * default that brings back. The action arrives as a prop and the page is
 * super admin only, so every viewer may edit.
 */

export interface TitleEditorProps {
  userId: string;
  personName: string;
  role: Role;
  /** The stored custom title, or null for the role's default. */
  title: string | null;
  /** The `setUserTitle` server action, passed down by the page. */
  action: SetTitleAction;
}

export function TitleEditor({ userId, personName, role, title, action }: TitleEditorProps) {
  const t = useTranslations("admin");
  const fallback = t(`titles.${role}`);

  return (
    <InlineTextEditor
      value={title}
      display={(stored) => (
        <span data-testid="person-title" className={cn(stored ? "text-foreground" : "text-muted-foreground")}>
          {displayTitle({ role, title: stored }, () => fallback)}
        </span>
      )}
      editLabel={t("personTitle.editFor", { name: personName })}
      editTooltip={t("personTitle.edit")}
      inputLabel={t("personTitle.label", { name: personName })}
      placeholder={t("personTitle.placeholder", { fallback })}
      hint={t("personTitle.hint", { max: USER_TITLE_MAX_LENGTH })}
      maxLength={USER_TITLE_MAX_LENGTH}
      save={async (draft) => {
        const result = await action({ userId, title: draft });
        return result.ok ? { ok: true, value: result.title, warning: result.warning } : result;
      }}
      describe={(code) => ("error" in code ? t(`errors.${code.error}`) : t(`warnings.${code.warning}`))}
    />
  );
}
