"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES } from "../i18n/config";
import { changeLocale } from "../i18n/actions";

export function LanguageSelector() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations("nav");
  const [isPending, startTransition] = useTransition();

  function onChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (next === locale) return;
    startTransition(async () => {
      // Persist the cookie + revalidate the layout server-side, then refresh
      // so all Server Components re-render in the new locale.
      await changeLocale(next);
      router.refresh();
    });
  }

  return (
    <label className="lang-select" title={t("languageLabel")}>
      <span className="lang-select-glyph" aria-hidden="true">
        文A
      </span>
      <span className="sr-only">{t("languageLabel")}</span>
      <select
        value={locale}
        onChange={onChange}
        disabled={isPending}
        aria-label={t("languageSelectorAria")}
      >
        {LOCALES.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
