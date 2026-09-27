import { listMaintenanceHistoryForUnit } from "../data/maintenance";
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
 * Pure data transforms plus one thin Postgres read wrapper (`../data/maintenance`,
 * spec §3.10 — the maintenance read left Notion in Phase 2; filing a ticket has
 * not).
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

/** Resolve a tool by id, slug, exact name, or partial name. */
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
    tools.find((t) => (t.officialName ?? "").toLowerCase() === needle) ||
    tools.find((t) => t.name.toLowerCase().includes(needle)) ||
    tools.find((t) => (t.officialName ?? "").toLowerCase().includes(needle)) ||
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
  /**
   * Who filed it — **only for a caller holding `maintenance.manage`** (MCP
   * access spec §3.2). Absent, not empty, for everyone else, so a model cannot
   * tell a redacted name from a ticket nobody signed. Never an email.
   */
  reported_by?: string;
}

/** The model sees a recap, not an archive — and the read is bounded to match. */
const MAX_MAINTENANCE_ENTRIES = 10;

export interface RecentMaintenanceOptions {
  /** Include the reporter's name. The caller decides with `can(identity, "maintenance.manage")`. */
  includeReporter?: boolean;
}

/**
 * Fetch the most recent maintenance logs for a unit (cap 10), flattened to the
 * shape both chat and MCP return — unchanged from when these rows lived in
 * Notion, so the tool descriptions and prompt fragments still describe what the
 * model gets. The query module carries more (resolution, resolved date,
 * reporter name); this is the subset the assistant has always been given, plus
 * the reporter's name for lab staff, who work the tickets (MCP access spec
 * §3.2: public and signed-in callers get dates, status and summaries only).
 *
 * Best-effort: resolves to [] on failure, as it always has. A failure here is
 * odd — resolving the unit already read the same database — so it is logged
 * rather than swallowed silently (Article 4).
 */
export function recentMaintenance(
  unitId: string,
  options: RecentMaintenanceOptions = {}
): Promise<MaintenanceEntry[]> {
  return listMaintenanceHistoryForUnit(unitId, { limit: MAX_MAINTENANCE_ENTRIES })
    .catch((err) => {
      console.warn("[capabilities] maintenance history unavailable", unitId, err);
      return [];
    })
    .then((logs) =>
      logs.map((log) => ({
        title: log.title,
        type: log.type,
        priority: log.priority,
        status: log.status,
        date_reported: log.dateReported,
        description: log.description,
        ...(options.includeReporter && log.reportedByName ? { reported_by: log.reportedByName } : {}),
      }))
    );
}
