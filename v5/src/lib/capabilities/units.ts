import { z } from "zod";
import { getCatalogTools } from "../catalog";
import {
  buildUnitLookup,
  findUnit,
  recentMaintenance,
  type MaintenanceEntry,
  type UnitLookupEntry,
} from "./helpers";
import type { Capability, CapabilityTool, PromptEnv } from "./types";
import type { MakerLabUnit } from "../../components/catalog-types";

/**
 * The `units` capability (design spec §3.4): tools for inspecting individual
 * physical units and their maintenance history. Ported verbatim from the
 * `get_unit_details` tool in the chat route and the `get_unit_details` /
 * `get_maintenance_history` tools in the MCP route, now sharing the unit-lookup
 * and maintenance helpers from `./helpers` so chat and MCP resolve units
 * identically.
 *
 * Both tools are `read`. `run()` returns plain structured data; neither emits a
 * card. Tools are surface-agnostic — they resolve the catalog themselves rather
 * than relying on anything in `ctx`, so they degrade fine under the MCP adapter
 * (no writer, no attachments).
 */

// ── get_unit_details ───────────────────────────────────────────────

interface GetUnitDetailsInput {
  unit_label: string;
}

type GetUnitDetailsResult =
  | { found: false; message: string }
  | {
      found: true;
      unit_id: string;
      unit_label: string;
      tool_name: string;
      tool_slug: string;
      status: MakerLabUnit["status"];
      condition: MakerLabUnit["condition"];
      location: string;
      serial: string;
      date_acquired: string | null;
      detail_page: string;
      maintenance_logs: MaintenanceEntry[];
    };

const getUnitDetailsInputSchema: z.ZodType<GetUnitDetailsInput> = z.object({
  unit_label: z
    .string()
    .describe("The unit label, e.g. 'Prusa #1' or 'Form 2 #1'."),
});

const getUnitDetails: CapabilityTool<
  GetUnitDetailsInput,
  GetUnitDetailsResult
> = {
  name: "get_unit_details",
  description:
    "Fetch details for a specific physical unit, including its status, condition, location, and recent maintenance history. Use when the student names or asks about a specific unit (e.g. 'Prusa #1', 'Form 2 #2') or reports an issue tied to one.",
  inputSchema: getUnitDetailsInputSchema,
  kind: "read",
  run: async ({ unit_label }: GetUnitDetailsInput): Promise<GetUnitDetailsResult> => {
    const tools = await getCatalogTools();
    const lookup = buildUnitLookup(tools);
    const match = findUnit(lookup, unit_label);
    if (!match) {
      const sample = lookup
        .slice(0, 8)
        .map((u: UnitLookupEntry) => u.label)
        .join(", ");
      return {
        found: false,
        message: `No unit found matching "${unit_label}". Some known units: ${sample}${lookup.length > 8 ? "…" : ""}`,
      };
    }

    return {
      found: true,
      unit_id: match.id,
      unit_label: match.label,
      tool_name: match.toolName,
      tool_slug: match.toolSlug,
      status: match.status,
      condition: match.condition,
      location: match.location,
      serial: match.serial,
      date_acquired: match.dateAcquired,
      detail_page: `/tools/${match.toolSlug}`,
      maintenance_logs: await recentMaintenance(match.id),
    };
  },
};

// ── get_maintenance_history ────────────────────────────────────────

interface GetMaintenanceHistoryInput {
  unit_label: string;
}

type GetMaintenanceHistoryResult =
  | { found: false; message: string }
  | {
      found: true;
      unit_label: string;
      unit_id: string;
      maintenance_logs: MaintenanceEntry[];
    };

const getMaintenanceHistoryInputSchema: z.ZodType<GetMaintenanceHistoryInput> =
  z.object({
    unit_label: z
      .string()
      .describe("The unit label to fetch maintenance history for"),
  });

const getMaintenanceHistory: CapabilityTool<
  GetMaintenanceHistoryInput,
  GetMaintenanceHistoryResult
> = {
  name: "get_maintenance_history",
  description:
    "Get recent maintenance logs for a unit by its label (e.g. 'Prusa #1'). Returns the most recent entries with type, priority, status, date, and description.",
  inputSchema: getMaintenanceHistoryInputSchema,
  kind: "read",
  run: async ({
    unit_label,
  }: GetMaintenanceHistoryInput): Promise<GetMaintenanceHistoryResult> => {
    const tools = await getCatalogTools();
    const lookup = buildUnitLookup(tools);
    const match = findUnit(lookup, unit_label);
    if (!match) {
      return {
        found: false,
        message: `No unit found matching "${unit_label}".`,
      };
    }
    return {
      found: true,
      unit_label: match.label,
      unit_id: match.id,
      maintenance_logs: await recentMaintenance(match.id),
    };
  },
};

// ── Prompt fragment ────────────────────────────────────────────────

/**
 * The "Unit details" guidance from the current chat system prompt. References
 * `get_unit_details`; `get_maintenance_history` is its read-only sibling that
 * returns only the log history.
 */
function promptFragment(_env: PromptEnv): string {
  return `## Unit details\n\nWhen a student asks about a specific unit ("how is Prusa #1 doing?", "is Form 2 #2 working?", "show me the history on the Trotec"), call \`get_unit_details\` to fetch its live status and recent maintenance history. Surface the status, condition, and a short recap of the most recent log entries. If the student only wants the maintenance history, \`get_maintenance_history\` returns just the recent log entries for a unit.`;
}

// ── Capability ─────────────────────────────────────────────────────

export const units: Capability = {
  id: "units",
  promptFragment,
  tools: [
    getUnitDetails as CapabilityTool<unknown, unknown>,
    getMaintenanceHistory as CapabilityTool<unknown, unknown>,
  ],
};
