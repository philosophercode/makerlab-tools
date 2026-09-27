"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * A choice of *how* to show a list — Sort, Group by — in a `FilterBar`
 * (UI system phase 5a; DESIGN.md §8.4). It looks like a `FacetFilter` (the
 * dimension, then the chosen value, ▾) but it narrows nothing, so it has no
 * counts and no "Any": it always holds a value, and the default is the first
 * option. The value on the button is shown in the accent ink only when it is
 * not the default, the way a set facet is.
 *
 * Radix's radio menu gives it arrow keys, Enter/Space, Escape and focus return.
 */
export interface ChoiceOption<V extends string> {
  value: V;
  label: string;
}

export interface ChoiceMenuProps<V extends string> {
  /** The dimension, translated ("Sort"). */
  label: string;
  value: V;
  options: ChoiceOption<V>[];
  onChange: (value: V) => void;
  /** The option that counts as "not changed" (defaults to the first). */
  defaultValue?: V;
}

export function ChoiceMenu<V extends string>({ label, value, options, onChange, defaultValue }: ChoiceMenuProps<V>) {
  const t = useTranslations("ui.filters");
  const current = options.find((option) => option.value === value) ?? options[0];
  const changed = current.value !== (defaultValue ?? options[0]?.value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="quiet"
          size="sm"
          aria-label={t("facetValue", { label, value: current.label })}
          className={cn("border-input", changed && "border-primary-ink text-foreground")}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="font-sans text-xs normal-case">{current.label}</span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.value} onValueChange={(next) => onChange(next as V)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="text-table">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
