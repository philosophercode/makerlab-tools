"use client";

import { ChevronDown, Columns3, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The filter bar every list shares (UI system spec §6.5): a search box, one
 * facet button per dimension, the count ("Showing 12 of 101"), and Clear.
 *
 * A facet's menu shows **how many rows each value would leave** — the counts
 * are the data, and they turn a guess ("is anything in Storage?") into a read.
 * Facets are single-valued, because the inventory's filters are links and a
 * link names one value per dimension.
 */

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface FacetFilterProps {
  label: string;
  anyLabel: string;
  value: string | null;
  options: FacetOption[];
  onChange: (value: string | null) => void;
}

export function FacetFilter({ label, anyLabel, value, options, onChange }: FacetFilterProps) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="quiet"
          size="sm"
          aria-label={current ? `${label}: ${current.label}` : label}
          className={cn("normal-case tracking-normal", current && "border-primary-ink/60 text-foreground")}
        >
          <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">{label}</span>
          {current ? <span className="font-sans text-[12px]">{current.label}</span> : null}
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 p-1">
        <DropdownMenuLabel className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(next) => onChange(next || null)}>
          <DropdownMenuRadioItem value="" className="text-[13px]">
            {anyLabel}
          </DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              disabled={option.count === 0 && option.value !== value}
              className="text-[13px]"
            >
              <span className="mr-4 flex-1">{option.label}</span>
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{option.count}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface ColumnToggle {
  id: string;
  label: string;
  visible: boolean;
}

export function ColumnsMenu({
  label,
  columns,
  onToggle,
}: {
  label: string;
  columns: ColumnToggle[];
  onToggle: (id: string, visible: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Columns3 aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground uppercase">
          {label}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.visible}
            onCheckedChange={(value) => onToggle(column.id, value === true)}
            onSelect={(event) => event.preventDefault()}
            className="text-[13px]"
          >
            {column.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface FilterBarProps {
  label: string;
  search: { value: string; onChange: (value: string) => void; label: string; placeholder: string };
  facets: React.ReactNode;
  /** "Showing 12 of 101" — the caller formats it (next-intl). */
  count: string;
  clear?: { label: string; onClear: () => void } | null;
  end?: React.ReactNode;
}

export function FilterBar({ label, search, facets, count, clear, end }: FilterBarProps) {
  return (
    <div role="search" aria-label={label} className="ui flex flex-wrap items-center gap-2 pb-3">
      <label className="relative flex min-w-0 flex-1 basis-56 items-center sm:max-w-72">
        <span className="sr-only">{search.label}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground" />
        <input
          type="search"
          value={search.value}
          placeholder={search.placeholder}
          onChange={(event) => search.onChange(event.target.value)}
          className="h-7 w-full border border-border bg-transparent pr-2 pl-7 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-ring focus-visible:outline-solid"
        />
      </label>
      {facets}
      {clear ? (
        <Button variant="ghost" size="sm" onClick={clear.onClear}>
          <X aria-hidden="true" />
          {clear.label}
        </Button>
      ) : null}
      <span className="ml-auto flex items-center gap-2">
        <span role="status" className="font-mono text-[11px] tracking-[0.04em] whitespace-nowrap text-muted-foreground tabular-nums">
          {count}
        </span>
        {end}
      </span>
    </div>
  );
}
