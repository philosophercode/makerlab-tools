import { z } from "zod";
import { writeTicket } from "../admin/ticket-write";
import { can } from "../auth/permissions";
import { listCatalogTools } from "../data/catalog";
import { listMaintenanceQueue } from "../data/maintenance";
import { listIntakeQueue, OPEN_PENDING_STATUSES } from "../data/pending-tools";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "../db/schema/vocabulary";
import { CHAT_PROPOSAL_FIELDS, PROPOSAL_VALUE_DESCRIPTION, proposeChange } from "./curation";
import { findTool } from "./helpers";
import type { Capability, CapabilityCtx, CapabilityTool, PromptEnv } from "./types";

/**
 * The `staff` capability — the lab staff's queue tools, in the site chat and
 * over MCP (MCP access spec §3.2, §3.3; amendment 2026-09-25 "Staff queue
 * tools in the site chat"). Every tool names its own permission, enforced once
 * per surface — `capabilitiesForIdentity` for the chat, `mcpToolAllowed` for
 * MCP — so an anonymous visitor or a student is offered none of them:
 *
 * - `list_intake_queue` (`tools.approve`) — what is waiting on `/admin/intake`,
 *   read-only. Research is never *started* from here: it spends money and
 *   stays a button press in the app (§2 non-goals, open question 1).
 * - `list_open_tickets` (`maintenance.manage`) — the open maintenance queue as
 *   on `/admin/maintenance`: reporter names (the caller holds
 *   `maintenance.manage`, the redaction rule's bar), never their email
 *   addresses (emails never enter a model's context).
 * - `update_ticket` (`maintenance.manage`) — status, priority, assignee,
 *   resolution, through `writeTicket`, the path the admin page's own action
 *   takes. The one direct write: working a queue is operational, not catalogue
 *   publishing (§3.3). In the chat the prompt makes the assistant state the
 *   exact change and wait for the person's yes before calling it.
 * - `propose_change` (`tools.edit`) — **MCP only.** A proposed change to a
 *   catalogue tool, stored as a `chat_proposals` row for a person to accept on
 *   `/admin/refresh`. **It writes nothing to the tool** (Article 5): a leaked
 *   token cannot rewrite the catalogue (§3.3, §8). PPE is refused. The chat has
 *   its own `propose_change` (the `curation` capability, composed per page),
 *   so this one never reaches the chat model and the two names never collide.
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
    "List the equipment waiting in the intake queue (identified, queued, researching, researched or failed) and the most recently approved or discarded items, with research confidence and a link to each item's review page. Staff only. Read-only: research is started and items are approved in the app.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
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
    "List the maintenance tickets still open or in progress, most urgent first — the queue on /admin/maintenance — with each ticket's id, tool, unit, status, priority, reporter's name and assignee. Staff only. To answer about one machine, filter the list by its tool. Use update_ticket with a ticket's id to work it.",
  inputSchema: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  kind: "read",
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
    "Work one maintenance ticket: change its status, priority, assignee (yourself or nobody) or resolution note. Only the fields you pass change — the same change the /admin/maintenance page makes. Staff only. Before calling it, tell the person exactly what will change on which ticket and wait for them to confirm; never call it on an unconfirmed request.",
  inputSchema: updateTicketSchema,
  kind: "write",
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
    .describe(PROPOSAL_VALUE_DESCRIPTION),
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
    "Propose one change to a catalogue tool's field for lab staff to accept or reject on /admin/refresh. It changes nothing by itself — never say the tool was updated. Never proposes PPE. Use restrictions and training are the lab's own rules: use_restrictions may only add a new line beside the lab's (give just the new line), and training_required is never turned off.",
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

// ── The chat's instructions ───────────────────────────────────────

/**
 * What the chat assistant is told about the staff tools — only the sections
 * for the tools this caller holds, and nothing at all for anybody else.
 *
 * The `can()` checks here are presentation: `capabilitiesForIdentity` has
 * already dropped every tool the caller does not hold, and this keeps the
 * prompt from describing tools that are not there. MCP clients never see this
 * text; `update_ticket`'s description carries the confirmation rule for them.
 */
export function staffPromptFragment(env: PromptEnv): string {
  const tickets = can(env.identity, "maintenance.manage");
  const intake = can(env.identity, "tools.approve");
  if (!tickets && !intake) return "";

  const sections: string[] = [
    `## Lab staff tools

The person you are talking to is lab staff, signed in. Besides helping like you would any student, you can read the lab's work queues for them.`,
  ];

  if (tickets) {
    sections.push(`### Maintenance queue

- **Reading.** When staff ask what maintenance is open, pending or broken — across the lab or on one machine ("what's open on the Form 4?") — call \`list_open_tickets\` and answer from its result, filtered to the machine they named. Give each ticket's title, status, priority, unit and who has it. Reporter names may be shown to staff; email addresses are never shown or asked for. If nothing matches, say so plainly — never invent a ticket.
- **Changing a ticket is a two-step conversation.** \`update_ticket\` writes to the live queue, so before you call it you must **state the exact change and ask for confirmation**, then stop and wait for their reply. Name the ticket by its title and machine, and list every field that will change: the new status (Open, In progress, Resolved, Closed), the priority, the assignee (\`me\` — the signed-in person — or \`nobody\`), and the resolution note word for word. For example: "I'll mark **Resin tank film clouded** (Form 4) as **Resolved** with the note "Replaced the tank." — shall I go ahead?"
- Call \`update_ticket\` **only after an explicit yes in a later message** ("yes", "go ahead", "do it"). A request that already sounds decided ("mark it resolved") still gets the confirmation step first. If they change the details, restate the new change and ask again. If more than one ticket could be meant, list them and ask which.
- Use the ticket id from \`list_open_tickets\` (call it first if you do not have the id) — never guess an id. Assign only to \`me\` or \`nobody\`; to hand a ticket to someone else, point them to /admin/maintenance.
- **Report only what the tool answered.** Say a ticket was updated only when \`update_ticket\` returned \`status: "updated"\`. If it refused, say what the refusal says and that nothing changed.
- Resolution notes are always written in **English**, whatever language the conversation is in.`);
  }

  if (intake) {
    sections.push(`### Intake queue

- When staff ask what equipment is waiting to be reviewed or researched, call \`list_intake_queue\` and summarise it, with each item's review page link. It is read-only: research is started and items are approved on /admin/intake, never from the chat.`);
  }

  return sections.join("\n\n");
}

export const staff: Capability = {
  id: "staff",
  // Chat instructions for staff only; MCP clients read the tool descriptions.
  promptFragment: staffPromptFragment,
  tools: [
    listIntakeQueueTool as unknown as CapabilityTool<unknown, unknown>,
    listOpenTicketsTool as unknown as CapabilityTool<unknown, unknown>,
    updateTicketTool as unknown as CapabilityTool<unknown, unknown>,
    mcpProposeTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};
