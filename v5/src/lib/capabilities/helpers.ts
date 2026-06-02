import { fetchMaintenanceLogsByUnit } from "../notion";
import type {
  MakerLabTool,
  MakerLabUnit,
} from "../../components/catalog-types";

/**
 * Shared catalog/unit/maintenance helpers used by the catalog + units (and
 * intake) capabilities. These were previously duplicated between the chat route
 * (`app/api/chat/route.ts`) and the MCP route (`app/api/mcp/route.ts`); they are
 * collapsed here so both adapters resolve units and summarize tools identically.
 *
 * Pure data transforms plus one thin Notion read wrapper — server-only via the
 * `../notion` import.
 */

// ── Unit lookup ────────────────────────────────────────────────────

/** A flattened, label-addressable view of a single physical unit. */
export interface UnitLookupEntry {
  id: string;
  label: string;
  toolName: string;
  toolSlug: string;
  status: MakerLabUnit["status"];
  condition: MakerLabUnit["condition"];
  location: string;
  serial: string;
  dateAcquired: string | null;
}

/**
 * Flatten the catalog's units into a lookup so we can resolve a unit by its
 * label the same way across chat and MCP.
 */
export function buildUnitLookup(tools: MakerLabTool[]): UnitLookupEntry[] {
  return tools.flatMap((tool) =>
    tool.units.map((unit) => ({
      id: unit.id,
      label: unit.name,
      toolName: tool.name,
      toolSlug: tool.slug,
      status: unit.status,
      condition: unit.condition,
      location: unit.location,
      serial: unit.serial,
      dateAcquired: unit.dateAcquired,
    }))
  );
}

/**
 * Resolve a unit by label: exact (case-insensitive) match first, then the first
 * substring match, else null.
 */
export function findUnit(
  units: UnitLookupEntry[],
  label: string
): UnitLookupEntry | null {
  const needle = label.trim().toLowerCase();
  if (!needle) return null;
  return (
    units.find((u) => u.label.toLowerCase() === needle) ||
    units.find((u) => u.label.toLowerCase().includes(needle)) ||
    null
  );
}

// ── Tool lookup / summaries ────────────────────────────────────────

/** Resolve a tool by Notion page id, slug, exact name, or partial name. */
export function findTool(
  tools: MakerLabTool[],
  idOrName: string
): MakerLabTool | null {
  const needle = idOrName.trim().toLowerCase();
  if (!needle) return null;
  return (
    tools.find(
      (t) => t.id.toLowerCase() === needle || t.slug.toLowerCase() === needle
    ) ||
    tools.find((t) => t.name.toLowerCase() === needle) ||
    tools.find((t) => t.name.toLowerCase().includes(needle)) ||
    null
  );
}

/** A compact one-line summary of a tool for list/search results. */
export function summarizeTool(tool: MakerLabTool): string {
  return [
    tool.name,
    `id: ${tool.id}`,
    `${tool.category}${tool.categorySub ? ` > ${tool.categorySub}` : ""}`,
    `${tool.location}${tool.zone ? ` / ${tool.zone}` : ""}`,
    `training: ${tool.trainingLevel}`,
    `status: ${tool.status}`,
  ].join(" | ");
}

// ── Maintenance ────────────────────────────────────────────────────

/** A flattened, model-friendly maintenance log entry. */
export interface MaintenanceEntry {
  title: string;
  type: string;
  priority: string;
  status: string;
  date_reported: string;
  description: string;
}

/**
 * Fetch the most recent maintenance logs for a unit (cap 10), flattened to the
 * shape both chat and MCP return. Best-effort: resolves to [] on failure.
 */
export function recentMaintenance(unitId: string): Promise<MaintenanceEntry[]> {
  return fetchMaintenanceLogsByUnit(unitId)
    .catch(() => [])
    .then((logs) =>
      logs.slice(0, 10).map((log) => ({
        title: log.fields.title,
        type: log.fields.type || "",
        priority: log.fields.priority || "",
        status: log.fields.status || "",
        date_reported: log.fields.date_reported || "",
        description: log.fields.description || "",
      }))
    );
}
