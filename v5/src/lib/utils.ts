import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge, taught the UI system's own type steps (`ui.css` `@theme`:
 * `text-micro`, `text-label`, `text-table`). Without this it reads an unknown
 * `text-*` as a colour, so `cn("text-label", "text-primary-foreground")` would
 * drop the size as a "conflict".
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "label", "table"],
    },
  },
});

/**
 * Join class names, letting a later Tailwind utility override an earlier one
 * (shadcn/ui's `cn`). The one class helper the UI system uses (spec §5.2).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
