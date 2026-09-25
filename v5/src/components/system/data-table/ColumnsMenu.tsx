"use client";

import { Columns3 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The Columns menu at the end of a `FilterBar`: one checkbox per column that
 * may be hidden, named by `meta.label`. It edits the same `VisibilityState`
 * the `DataTable` is given, so the two cannot disagree. The menu stays open
 * while columns are toggled — hiding three columns is one trip, not three.
 */
export interface ColumnsMenuProps<T> {
  columns: ColumnDef<T, unknown>[];
  visibility: VisibilityState;
  onChange: (next: VisibilityState) => void;
}

export function ColumnsMenu<T>({ columns, visibility, onChange }: ColumnsMenuProps<T>) {
  const t = useTranslations("ui.filters");
  const hideable = columns.filter((column) => column.enableHiding !== false && column.id);
  if (hideable.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <Columns3 aria-hidden="true" />
          {t("columns")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel>{t("columns")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {hideable.map((column) => {
          const id = column.id as string;
          return (
            <DropdownMenuCheckboxItem
              key={id}
              checked={visibility[id] !== false}
              onCheckedChange={(on) => onChange({ ...visibility, [id]: on === true })}
              onSelect={(event) => event.preventDefault()}
              className="text-table"
            >
              {column.meta?.label ?? id}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
