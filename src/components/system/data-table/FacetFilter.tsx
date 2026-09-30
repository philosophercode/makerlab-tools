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
 * One facet of a `FilterBar` (DESIGN.md §8.4): a button naming the dimension —
 * and the value, once one is chosen (`STATE Draft ▾`) — that opens a menu of
 * values **with the count each would leave** given every other active filter.
 * A value that would leave nothing is disabled rather than hidden, so the
 * menu still says it exists; the chosen one stays enabled so it can be seen.
 *
 * Single-valued on purpose: the lists' filters are links, and a link names
 * one value per dimension.
 */

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface FacetFilterProps {
  /** The dimension, translated ("State"). Also the button's accessible name. */
  label: string;
  value: string | null;
  options: FacetOption[];
  onChange: (value: string | null) => void;
  /** The "no filter" entry; defaults to "Any". */
  anyLabel?: string;
}

export function FacetFilter({ label, value, options, onChange, anyLabel }: FacetFilterProps) {
  const t = useTranslations("ui.filters");
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="quiet"
          size="sm"
          aria-label={current ? t("facetValue", { label, value: current.label }) : label}
          className={cn("border-input", current && "border-primary-ink text-foreground")}
        >
          <span className="text-muted-foreground">{label}</span>
          {current ? <span className="max-w-[10rem] truncate font-sans text-xs normal-case">{current.label}</span> : null}
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(next) => onChange(next || null)}>
          <DropdownMenuRadioItem value="" className="text-table">
            {anyLabel ?? t("any")}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={option.count === 0 && option.value !== value}
              className="text-table"
            >
              <span className="me-4 flex-1">{option.label}</span>
              <span className="font-mono text-label text-muted-foreground tabular-nums">{option.count}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
