import { z } from "zod";
import { writeTicket } from "../admin/ticket-write";
import { listCatalogTools } from "../data/catalog";
import { listMaintenanceQueue } from "../data/maintenance";
import { listIntakeQueue, OPEN_PENDING_STATUSES } from "../data/pending-tools";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "../db/schema/vocabulary";
import { CHAT_PROPOSAL_FIELDS, proposeChange } from "./curation";
import { findTool } from "./helpers";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * The `staff` capability — the lab staff's tools over MCP (MCP access spec
 * §3.2, §3.3). Every tool is MCP-only and names its own permission, checked by
 * the adapter before the tool is listed and again before it runs:
 *
 * - `list_intake_queue` (`tools.approve`) — what is waiting on `/admin/intake`,
 *   read-only. Research is never *started* over MCP: it spends money and stays
 *   a button press in the app (§2 non-goals, open question 1).
 * - `list_open_tickets` (`maintenance.manage`) — the open maintenance queue as
 *   on `/admin/maintenance`: reporter names, never their email addresses
 *   (emails never enter a model's context).
 * - `update_ticket` (`maintenance.manage`) — status, priority, assignee,
 *   resolution, through `writeTicket`, the path the admin page's own action
 *   takes. The one direct write over MCP: working a queue is operational, not
 *   catalogue publishing (§3.3).
 * - `propose_change` (`tools.edit`) — a proposed change to a catalogue tool,
 *   stored as a `chat_proposals` row for a person to accept on
 *   `/admin/refresh`. **It writes nothing to the tool** (Article 5): a leaked
 *   token cannot rewrite the catalogue (§3.3, §8). PPE is refused.
 */

// ── list_intake_queue ─────────────────────────────────────────────

/** Settled (approved or discarded) items listed beneath the open ones. */
const INTAKE_SETTLED_SHOWN = 20;

interface IntakeQueueEntry {
  id: string;
  name: string;
  brand: string | null;
  status: string;
  confidence: string | null;
  duplicate_of: string | null;
  research_error: string | null;
  added_by: string | null;
  added_at: string;
  review_page: string;
}

const listIntakeQueueTool: CapabilityTool<Record<string, never>, { open: IntakeQueueEntry[]; recently_settled: IntakeQueueEntry[] }> = {
  name: "list_intake_queue",
  description:
    "List the equipment waiting in the intake queue (identified, queued, researching, researched or failed) and the most recently approved or discarded items, with research confidence and a link to each item's review page. Read-only: research is started and items are approved in the app.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
  mcpOnly: true,
  requiredPermission: "tools.approve",
  run: async () => {
    const items = await listIntakeQueue({ settledLimit: INTAKE_SETTLED_SHOWN });
    const open = new Set<string>(OPEN_PENDING_STATUSES);
    const entries = items.map(
      (item): IntakeQueueEntry => ({
        id: item.id,
        name: item.name,
        brand: item.brand,
        status: item.status,
        confidence: item.research?.confidence.level ?? null,
        duplicate_of: item.duplicateOf?.name ?? null,
        research_error: item.researchError,
        added_by: item.createdByName,
        added_at: item.createdAt.toISOString(),
        review_page: `/admin/intake/${item.id}`,
      })
    );
    return {
      open: entries.filter((entry) => open.has(entry.status)),
      recently_settled: entries.filter((entry) => !open.has(entry.status)),
    };
  },
};

// ── list_open_tickets ─────────────────────────────────────────────

interface OpenTicket {
  id: string;
  title: string;
  description: string;
  tool: string;
  unit: string;
  status: string;
  priority: string | null;
  reported_by: string;
  assigned_to: string;
  date_reported: string;
}

const listOpenTicketsTool: CapabilityTool<Record<string, never>, { count: number; tickets: OpenTicket[] }> = {
  name: "list_open_tickets",
  description:
    "List the maintenance tickets still open or in progress, most urgent first — the queue on /admin/maintenance. Use update_ticket with a ticket's id to work it.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
  mcpOnly: true,
  requiredPermission: "maintenance.manage",
  run: async () => {
    const queue = await listMaintenanceQueue();
    const tickets = queue
      .filter((ticket) => ticket.status === "open" || ticket.status === "in_progress")
      .map(
        (ticket): OpenTicket => ({
          id: ticket.id,
          title: ticket.title,
          description: ticket.description,
          tool: ticket.toolName,
          unit: ticket.unitLabel,
          status: ticket.status,
          priority: ticket.priority,
          // The name, as the admin page shows it; the email stays on the page.
          reported_by: ticket.reportedByName,
          assigned_to: ticket.assignedToName,
          date_reported: ticket.dateReported,
        })
      );
    return { count: tickets.length, tickets };
  },
};

// ── update_ticket ─────────────────────────────────────────────────

interface UpdateTicketInput {
  ticket_id: string;
  status?: (typeof MAINTENANCE_STATUS)[number];
  priority?: (typeof MAINTENANCE_PRIORITY)[number] | "none";
  assign_to?: "me" | "nobody";
  resolution?: string;
}

const updateTicketSchema: z.ZodType<UpdateTicketInput> = z.object({
  ticket_id: z.string().max(64).describe("The ticket's id, from list_open_tickets"),
  status: z.enum(MAINTENANCE_STATUS).optional().describe("New status"),
  priority: z
    .enum([...MAINTENANCE_PRIORITY, "none"] as const)
    .optional()
    .describe("New priority, or 'none' to clear it"),
  assign_to: z.enum(["me", "nobody"]).optional().describe("Assign the ticket to yourself, or unassign it"),
  resolution: z.string().max(2000).optional().describe("What was done — shown to staff and to the reporter"),
});

type UpdateTicketResult = { status: "updated"; ticket_id: string } | { status: "refused"; code: string; message: string };

const REFUSALS: Record<string, string> = {
  not_found: "No ticket has that id.",
  invalid_field: "A status or priority outside the list was given.",
  not_signed_in: "Sign in to work tickets.",
  not_permitted: "Your account cannot work maintenance tickets.",
  rate_limited: "Too many changes at once — wait a minute.",
  failed: "The change did not land. Try again shortly.",
};

const updateTicketTool: CapabilityTool<UpdateTicketInput, UpdateTicketResult> = {
  name: "update_ticket",
  description:
    "Work one maintenance ticket: change its status, priority, assignee (yourself or nobody) or resolution. Only the fields you pass change. The same change the /admin/maintenance page makes.",
  inputSchema: updateTicketSchema,
  kind: "write",
  mcpOnly: true,
  requiredPermission: "maintenance.manage",
  run: async (input, ctx: CapabilityCtx): Promise<UpdateTicketResult> => {
    const identity = ctx.identity;
    if (!identity) return { status: "refused", code: "not_signed_in", message: REFUSALS.not_signed_in };
    const patch: Parameters<typeof writeTicket>[0]["patch"] = {};
    if (input.status) patch.status = input.status;
    if (input.priority) patch.priority = input.priority === "none" ? null : input.priority;
    if (input.assign_to === "me") {
      patch.assignedToUserId = identity.userId;
      patch.assignedToName = identity.name;
    } else if (input.assign_to === "nobody") {
      patch.assignedToUserId = null;
      patch.assignedToName = null;
    }
    if (input.resolution !== undefined) patch.resolution = input.resolution.trim() || null;
    if (Object.keys(patch).length === 0) {
      return { status: "refused", code: "nothing_to_change", message: "Pass at least one of status, priority, assign_to or resolution." };
    }

    const result = await writeTicket({ logId: input.ticket_id.trim(), patch }, { identity, surface: "mcp/update_ticket" });
    if (!result.ok) return { status: "refused", code: result.error, message: REFUSALS[result.error] ?? REFUSALS.failed };
    return { status: "updated", ticket_id: input.ticket_id.trim() };
  },
};

// ── propose_change ────────────────────────────────────────────────

interface McpProposeInput {
  tool: string;
  field: string;
  value?: unknown;
  citations?: { quote: string; url: string }[];
  reason?: string;
}

const mcpProposeSchema: z.ZodType<McpProposeInput> = z.object({
  tool: z.string().max(200).describe("The catalogue tool: its id, slug or name"),
  field: z
    .string()
    .max(40)
    .describe(`One of: ${CHAT_PROPOSAL_FIELDS.join(", ")}. Never PPE — staff set it.`),
  value: z
    .unknown()
    .describe(
      "The proposed value: a string (name, description, use_restrictions, emergency_stop, floor_check), the complete list of strings (materials, tags), true/false (training_required), or { title, url, type: Manual|Video|Other } (resource)."
    ),
  citations: z
    .array(z.object({ quote: z.string().max(1000), url: z.string().max(2000) }))
    .max(3)
    .optional()
    .describe("1–3 verbatim quotes from your sources, each with the page's URL. Staff see them marked unverified: the server cannot see what you read."),
  reason: z.string().max(1000).optional().describe("One short line on why, shown to staff."),
});

const mcpProposeTool: CapabilityTool<McpProposeInput, Record<string, unknown>> = {
  name: "propose_change",
  description:
    "Propose one change to a catalogue tool's field for lab staff to accept or reject on /admin/refresh. It changes nothing by itself — never say the tool was updated. Never proposes PPE.",
  inputSchema: mcpProposeSchema,
  kind: "write",
  mcpOnly: true,
  requiredPermission: "tools.edit",
  run: async (input, ctx: CapabilityCtx) => {
    // Every tool but archived ones — a draft is exactly what a proposal may fix.
    const tool = findTool(await listCatalogTools({ includeDrafts: true }), input.tool);
    if (!tool) {
      return { status: "refused", code: "not_found", message: `No catalogue tool matches "${input.tool.slice(0, 80)}".` };
    }
    return proposeChange(
      {
        subject: { kind: "tool", id: tool.id },
        field: input.field,
        value: input.value,
        citations: input.citations,
        reason: input.reason,
      },
      ctx,
      { kind: "tool", id: tool.id },
      "mcp"
    );
  },
};

export const staff: Capability = {
  id: "staff",
  // MCP-only: nothing for the chat prompt to say.
  promptFragment: () => "",
  tools: [
    listIntakeQueueTool as unknown as CapabilityTool<unknown, unknown>,
    listOpenTicketsTool as unknown as CapabilityTool<unknown, unknown>,
    updateTicketTool as unknown as CapabilityTool<unknown, unknown>,
    mcpProposeTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};
