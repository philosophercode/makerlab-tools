"use client";

import { useTranslations } from "next-intl";

type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const CYCLE: Record<ThemeChoice, ThemeChoice> = {
  system: "light",
  light: "dark",
  dark: "system",
};

function readChoice(): ThemeChoice {
  if (typeof document === "undefined") return "system";
  const value = document.documentElement.getAttribute("data-theme");
  if (value === "light" || value === "dark") return value;
  return "system";
}

function applyChoice(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    root.setAttribute("data-theme", choice);
    window.localStorage.setItem(STORAGE_KEY, choice);
  }
}

/**
 * The theme control: system → light → dark. `square` (the bar's) shows the
 * current choice's glyph; `row` (the phone bar's MENU, DESIGN.md §8.12
 * amendment "The phone bar") is a touch row with the glyph and "Theme".
 */
export function ThemeToggle({ variant = "square" }: { variant?: "square" | "row" }) {
  const t = useTranslations("nav");

  function cycle() {
    const next = CYCLE[readChoice()];
    applyChoice(next);
  }

  return (
    <button
      type="button"
      className={variant === "row" ? "theme-toggle theme-toggle-row" : "theme-toggle"}
      onClick={cycle}
      aria-label={t("themeToggleAria")}
      title={t("themeToggleTitle")}
    >
      {variant === "row" ? <span>{t("theme")}</span> : null}
    </button>
  );
}
