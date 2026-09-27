import "server-only";

import { z } from "zod";
import { MAINTENANCE_PATH, type MaintenanceWriteError } from "../../app/admin/maintenance/action-result";
import { findActiveToolByRef, findUnitOfTool } from "../data/action-subjects";
import { COMPLETED_MAINTENANCE_TYPES, logCompletedMaintenance, type CompletedMaintenanceType } from "../data/maintenance";
import { isOneOf } from "../db/schema/vocabulary";
import { requestMirrorPush } from "../mirror/trigger";
import { defineAction, toolShape } from "./define";

/**
 * **Log completed maintenance** (assistant–GUI parity spec §11 answer 5): a
 * record of work somebody already did — "replaced the belt on the WEN" — as a
 * ticket that starts resolved, with them as reporter and assignee. The one
 * ability the owner's examples needed that no GUI had, so it lands on
 * `/admin/maintenance` and as `log_completed_maintenance` together (parity
 * runs both ways).
 *
 * `maintenance.manage`, like working a ticket. No audit event (§4.11: an
 * ordinary record, and the row names its author), no cache (nothing cached
 * reads tickets); the Notion mirror is told, as for every ticket.
 */

export const LOG_TITLE_MAX = 200;
export const LOG_RESOLUTION_MAX = 2000;

export interface LogCompletedInput {
  /** The tool's id or slug. */
  tool: string;
  /** One of the tool's units, or absent for the tool as a whole. */
  unitId?: string | null;
  /** A short line: "Replaced the drive belt". */
  title: string;
  /** What was done, in full. */
  resolution: string;
  type: string;
}

interface Resolved {
  toolId: string;
  toolName: string;
  unit: { id: string; label: string } | null;
  title: string;
  resolution: string;
  type: CompletedMaintenanceType;
}

/** The input as it will be written, or the code that refuses it. Reads, never writes. */
async function resolve(input: LogCompletedInput): Promise<{ ok: true; value: Resolved } | { ok: false; error: MaintenanceWriteError }> {
  const title = input.title.replace(/\s+/g, " ").trim();
  const resolution = input.resolution.trim();
  if (!title || title.length > LOG_TITLE_MAX) return { ok: false, error: "invalid_field" };
  if (!resolution || resolution.length > LOG_RESOLUTION_MAX) return { ok: false, error: "invalid_field" };
  if (!isOneOf(COMPLETED_MAINTENANCE_TYPES, input.type)) return { ok: false, error: "invalid_field" };
  const tool = await findActiveToolByRef(input.tool);
  if (!tool) return { ok: false, error: "not_found" };
  let unit: { id: string; label: string } | null = null;
  if (input.unitId) {
    unit = await findUnitOfTool(tool.id, input.unitId);
    // A unit of some other machine is a mistake, not "the tool as a whole".
    if (!unit) return { ok: false, error: "invalid_field" };
  }
  return { ok: true, value: { toolId: tool.id, toolName: tool.name, unit, title, resolution, type: input.type } };
}

export const TICKETS_LOG_COMPLETED = defineAction<LogCompletedInput, { logId: string }, MaintenanceWriteError>({
  id: "tickets.log_completed",
  toolName: "log_completed_maintenance",
  description:
    "Record maintenance that was already done on a tool (a repair, preventive maintenance, an inspection or a calibration) as a resolved log, with the signed-in person as the one who did it. For a problem that still needs fixing, use report_issue instead. Proposes the log; nothing is recorded until the person confirms it on the card.",
  permission: "maintenance.manage",
  risk: "operational",
  input: z.object({
    tool: z.string().max(200),
    unitId: z.string().max(64).nullable().optional(),
    title: z.string().max(LOG_TITLE_MAX * 2),
    resolution: z.string().max(LOG_RESOLUTION_MAX * 2),
    type: z.string().max(40),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.tool }),
  check: async (input) => {
    const resolved = await resolve(input);
    return resolved.ok ? null : resolved.error;
  },
  tool: toolShape(
    z.strictObject({
      tool: z.string().min(1).max(200).describe("The tool's slug from the catalogue (or its id)"),
      unit_id: z.string().max(64).optional().describe("One unit's id, when the work was on one unit (from get_unit_details); leave out for the tool as a whole"),
      title: z.string().min(1).max(LOG_TITLE_MAX).describe("A short English line naming the work: \"Replaced the drive belt\""),
      what_was_done: z.string().min(1).max(LOG_RESOLUTION_MAX).describe("What was done, in English, as the person said it"),
      type: z.enum(COMPLETED_MAINTENANCE_TYPES).optional().describe("repair (default), preventive_maintenance, inspection or calibration"),
    }),
    (args) => ({
      ok: true,
      inputs: [
        { tool: args.tool, unitId: args.unit_id ?? null, title: args.title, resolution: args.what_was_done, type: args.type ?? "repair" },
      ],
    })
  ),
  preview: async (input) => {
    const resolved = await resolve(input);
    if (!resolved.ok) return null;
    const { toolName, unit, title, resolution, type } = resolved.value;
    return {
      summary: { key: "tickets_log_completed", values: { tool: unit ? `${toolName} · ${unit.label}` : toolName } },
      rows: [
        { field: "title", before: null, after: title },
        { field: "type", before: null, after: type, format: "maintenanceType" },
        { field: "resolution", before: null, after: resolution },
        { field: "status", before: null, after: "resolved", format: "ticketStatus" },
      ],
      subjectName: toolName,
      link: MAINTENANCE_PATH,
    };
  },
  run: async (input, ctx) => {
    const resolved = await resolve(input);
    if (!resolved.ok) return resolved;
    const actorId = ctx.identity.userId;
    if (!actorId) return { ok: false, error: "not_signed_in" };
    const { toolId, toolName, unit, title, resolution, type } = resolved.value;
    const logged = await logCompletedMaintenance({
      toolId,
      toolName,
      unitId: unit?.id ?? null,
      unitLabel: unit?.label ?? null,
      title,
      resolution,
      type,
      actor: { userId: actorId, name: ctx.identity.name ?? "" },
    });
    return { ok: true, value: { logId: logged.id }, committed: true };
  },
  afterCommit: async () => {
    await requestMirrorPush();
    return undefined;
  },
  revalidate: [MAINTENANCE_PATH],
});
