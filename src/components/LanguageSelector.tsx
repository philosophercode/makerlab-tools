"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES } from "../i18n/config";
import { changeLocale } from "../i18n/actions";

/**
 * The language control. `square` (the bar's): a 32px square showing its 文A
 * glyph. `row` (the phone bar's MENU, DESIGN.md §8.12 amendment "The phone
 * bar"): a touch row — the glyph, "Language" and the current language's
 * name. Either way the select covers the whole control with its own text
 * transparent, so a press anywhere opens the platform's list.
 */
export function LanguageSelector({ variant = "square" }: { variant?: "square" | "row" }) {
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

  const row = variant === "row";
  return (
    <label className={row ? "lang-select lang-select-row" : "lang-select"} title={t("languageLabel")}>
      <span className="lang-select-glyph" aria-hidden="true">
        文A
      </span>
      {row ? (
        <>
          <span className="lang-select-label" aria-hidden="true">
            {t("languageLabel")}
          </span>
          <span className="lang-select-current" aria-hidden="true">
            {LOCALES.find((option) => option.code === locale)?.label ?? locale}
          </span>
        </>
      ) : (
        <span className="sr-only">{t("languageLabel")}</span>
      )}
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
