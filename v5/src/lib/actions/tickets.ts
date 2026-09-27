import "server-only";

import { z } from "zod";
import { MAINTENANCE_PATH, type MaintenanceWriteError } from "../../app/admin/maintenance/action-result";
import { updateMaintenanceLog } from "../data/maintenance";
import { requestMirrorPush } from "../mirror/trigger";
import { defineAction } from "./define";

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
