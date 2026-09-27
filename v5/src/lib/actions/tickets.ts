import "server-only";

import { z } from "zod";
import { MAINTENANCE_PATH, type MaintenanceWriteError } from "../../app/admin/maintenance/action-result";
import { ticketSubjects } from "../data/action-subjects";
import { updateMaintenanceLog } from "../data/maintenance";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "../db/schema/vocabulary";
import { requestMirrorPush } from "../mirror/trigger";
import { defineAction, toolShape, type ActionPreviewRow } from "./define";
import { recordIds } from "./tool-args";

/**
 * Working one maintenance ticket (spec §4.6 #41) — `/admin/maintenance`'s
 * server action, `writeTicket` (MCP's and the chat's `update_ticket`) and,
 * from phase 2, the confirmation card all run this definition.
 *
 * `maintenance.manage`, then the write. **No audit event** (§4.11: an
 * ordinary edit; `maintenance_logs` carries `updated_by`) and **no cache
 * invalidation** (nothing cached reads a ticket). It does tell the Notion
 * mirror, which carries every log; `requestMirrorPush()` never throws and
 * coalesces a burst into one push.
 *
 * The patch is what keeps one-control-saves-on-click safe: an unsent key is
 * not written. Its values are checked by `updateMaintenanceLog`, which answers
 * `invalid_field` for a status or priority outside the vocabulary, so the
 * schema here checks only the shape.
 */
export const TICKETS_UPDATE = defineAction<
  {
    logId: string;
    patch: {
      status?: string;
      priority?: string | null;
      assignedToUserId?: string | null;
      assignedToName?: string | null;
      resolution?: string | null;
    };
  },
  object,
  MaintenanceWriteError
>({
  id: "tickets.update",
  toolName: "update_ticket",
  description:
    "Work one maintenance ticket: change its status, priority, assignee or resolution note. Only the fields passed change.",
  permission: "maintenance.manage",
  risk: "operational",
  // Grandfathered (§11 answer 4): MCP clients already commit `update_ticket`
  // directly, and it keeps working. Every other action proposes over MCP.
  mcp: "direct",
  maxBatch: 20,
  input: z.object({
    logId: z.string(),
    patch: z.object({
      status: z.string().optional(),
      priority: z.string().nullable().optional(),
      assignedToUserId: z.string().nullable().optional(),
      assignedToName: z.string().nullable().optional(),
      resolution: z.string().nullable().optional(),
    }),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "maintenance_log", id: input.logId }),
  // The chat's `update_ticket` (§11 answer 1: the card replaced the typed yes).
  // Assign only to the caller or nobody, as before; handing a ticket to
  // somebody else stays on the page.
  tool: toolShape(
    z.strictObject({
      ticket_ids: recordIds("tickets"),
      status: z.enum(MAINTENANCE_STATUS).optional().describe("New status"),
      priority: z.enum([...MAINTENANCE_PRIORITY, "none"] as const).optional().describe("New priority, or 'none' to clear it"),
      assign_to: z.enum(["me", "nobody"]).optional().describe("Assign to the signed-in person, or unassign"),
      resolution: z.string().max(2000).optional().describe("What was done, in English — shown to staff and to the reporter"),
    }),
    (args, ctx) => {
      const patch: {
        status?: string;
        priority?: string | null;
        assignedToUserId?: string | null;
        assignedToName?: string | null;
        resolution?: string | null;
      } = {};
      if (args.status) patch.status = args.status;
      if (args.priority) patch.priority = args.priority === "none" ? null : args.priority;
      if (args.assign_to === "me") {
        patch.assignedToUserId = ctx.identity.userId;
        patch.assignedToName = ctx.identity.name;
      } else if (args.assign_to === "nobody") {
        patch.assignedToUserId = null;
        patch.assignedToName = null;
      }
      if (args.resolution !== undefined) patch.resolution = args.resolution.trim() || null;
      if (Object.keys(patch).length === 0) return { ok: false, error: "nothing_to_change" };
      return { ok: true, inputs: args.ticket_ids.map((logId) => ({ logId, patch })) };
    }
  ),
  preview: async (input) => {
    const [ticket] = await ticketSubjects([input.logId]);
    if (!ticket) return null;
    const { patch } = input;
    const rows: ActionPreviewRow[] = [];
    if (patch.status !== undefined) rows.push({ field: "status", before: ticket.status, after: patch.status, format: "ticketStatus" });
    if (patch.priority !== undefined) rows.push({ field: "priority", before: ticket.priority, after: patch.priority, format: "priority" });
    if (patch.assignedToUserId !== undefined || patch.assignedToName !== undefined) {
      rows.push({ field: "assignee", before: ticket.assignedToName || null, after: patch.assignedToName ?? null });
    }
    if (patch.resolution !== undefined) rows.push({ field: "resolution", before: ticket.resolution || null, after: patch.resolution });
    return {
      summary: { key: "tickets_update", values: { title: ticket.title, tool: ticket.toolName || "—" } },
      rows,
      subjectName: ticket.title,
      link: MAINTENANCE_PATH,
    };
  },
  run: async (input, ctx) => {
    const outcome = await updateMaintenanceLog(input.logId, input.patch, { actorUserId: ctx.identity.userId });
    if (!outcome.ok) return { ok: false, error: outcome.reason };
    return { ok: true, value: {}, committed: true };
  },
  afterCommit: async () => {
    await requestMirrorPush();
    return undefined;
  },
  revalidate: [MAINTENANCE_PATH],
});
