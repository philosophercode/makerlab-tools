"use client";

import { useTranslations } from "next-intl";
import { PERSON_NAME_MAX_LENGTH } from "../../lib/people/name";
import type { UpdateOwnNameResult } from "../../lib/account/name-actions";
import { InlineTextEditor } from "../system/InlineTextEditor";

/**
 * **Name** on `/account`: your own display name, with the same pencil and
 * inline field the People page uses (`InlineTextEditor`). The action is a prop
 * — `updateOwnNameAction`, which only ever renames the caller — so this
 * component never imports the server's graph and a test can pass a `vi.fn`.
 */

export interface OwnNameEditorProps {
  name: string;
  action: (input: { name: string }) => Promise<UpdateOwnNameResult>;
}

export function OwnNameEditor({ name, action }: OwnNameEditorProps) {
  const t = useTranslations("account.profile");

  return (
    <InlineTextEditor
      value={name}
      display={(stored) => (
        <span data-testid="own-name" className="text-base font-medium">
          {stored}
        </span>
      )}
      editLabel={t("editFor")}
      editTooltip={t("edit")}
      inputLabel={t("label")}
      hint={t("hint", { max: PERSON_NAME_MAX_LENGTH })}
      maxLength={PERSON_NAME_MAX_LENGTH}
      save={async (draft) => {
        const result = await action({ name: draft });
        return result.ok ? { ok: true, value: result.name, warning: result.warning } : result;
      }}
      describe={(code) => ("error" in code ? t(`errors.${code.error}`) : t(`warnings.${code.warning}`))}
    />
  );
}
