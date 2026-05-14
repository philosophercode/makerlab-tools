"use client";

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

export function ThemeToggle() {
  function cycle() {
    const next = CYCLE[readChoice()];
    applyChoice(next);
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label="Cycle color theme (system → light → dark)"
      title="Cycle color theme"
    />
  );
}
