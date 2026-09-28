"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import type { GalleryTool } from "./catalog-types";
import { DataTable } from "./system/data-table/DataTable";
import { TOOL_STATUS_KEY } from "./ToolCard";
import { Thumb } from "./gallery-columns";
import { availableUnits } from "./gallery-filters";

/**
 * The gallery's table view on the shared `DataTable` — the inventory's
 * controls for the public catalogue (public polish): every column sorts (a
 * header click sorts on top of the filtered, ranked order), the Columns menu
 * in the toolbar hides the ones a reader does not need (official name and
 * materials start hidden), rows are dense with a sticky header, the keyboard
 * moves between rows and Enter opens the tool, and a phone gets a two-line
 * item per tool.
 *
 * The columns are built by `useGalleryColumns` (`gallery-columns.tsx`), which `GalleryShell`
 * also hands its `ColumnsMenu`, so the menu and every grouped section's table
 * share one visibility state.
 */

export function GalleryTable({
  tools,
  columns,
  visibility,
  label,
  stickyHeader,
  keyboardHint,
}: {
  tools: GalleryTool[];
  columns: ColumnDef<GalleryTool, unknown>[];
  visibility: VisibilityState;
  /** The table's name: the gallery's, or its section's when grouped. */
  label?: string;
  /** Off under a group's own sticky heading. */
  stickyHeader?: boolean;
  /** Said once, not under every group's table. */
  keyboardHint?: boolean;
}) {
  const t = useTranslations("gallery");
  const router = useRouter();

  return (
    <DataTable
      data={tools}
      columns={columns}
      getRowId={getRowId}
      getRowName={getRowName}
      labels={{ table: label ?? t("toolGalleryLabel") }}
      columnVisibility={visibility}
      stickyHeader={stickyHeader}
      keyboardHint={keyboardHint}
      empty={null}
      onActivate={(tool) => router.push(`/tools/${tool.slug}`)}
      mobileRow={(tool) => (
        <Link href={`/tools/${tool.slug}`} className="flex items-center gap-3 px-1 py-2">
          <Thumb tool={tool} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">{tool.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[t(`status.${TOOL_STATUS_KEY[tool.status]}`), tool.category, tool.zone].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="ms-auto font-mono text-xs text-muted-foreground tabular-nums">
            {availableUnits(tool)}/{tool.units.length}
          </span>
        </Link>
      )}
    />
  );
}

const getRowId = (tool: GalleryTool) => tool.id;
const getRowName = (tool: GalleryTool) => tool.name;

