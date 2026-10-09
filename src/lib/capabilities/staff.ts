import { z } from "zod";
import { fenceUntrusted, OTHERS_TEXT_NOTE } from "../web/fence";
import { writeTicket } from "../admin/ticket-write";
import { can } from "../auth/permissions";
import { listCatalogTools } from "../data/catalog";
import { listMaintenanceQueue } from "../data/maintenance";
import { listDueSchedules } from "../data/maintenance-schedules";
import { listIntakeQueue, OPEN_PENDING_STATUSES } from "../data/pending-tools";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS } from "../db/schema/vocabulary";
import { labToday } from "../lab-time";
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
 * - `list_maintenance_due` (`maintenance.manage`) — the recurring tasks
 *   overdue or due soon, as on `/admin/maintenance` (recurring maintenance
 *   spec, amendment 2026-10-06). Read-only: a task is checked off with
 *   **Done** in the app. Titles and instructions are staff-written, so the
 *   result does not taint the turn.
 * - `update_ticket` (`maintenance.manage`) — **MCP only** since the
 *   assistant–GUI parity spec's phase 2: status, priority, assignee,
 *   resolution, through `writeTicket`, the path the admin page's own action
 *   takes. The one direct write MCP keeps (§11 answer 4). In the chat the
 *   tool of that name is the generated one (`capabilities/actions.ts`), which
 *   proposes a card the person confirms — the typed "yes" is retired
 *   (§11 answer 1).
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
    "List the maintenance tickets still open or in progress, most urgent first — the queue on /admin/maintenance — with each ticket's id, tool, unit, status, priority, reporter's name and assignee, and the description fenced as untrusted text. Staff only. To answer about one machine, filter the list by its tool. Use update_ticket with a ticket's id to work it.",
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
          // A reporter's words — often an anonymous visitor's — are data,
          // never instructions (assistant–GUI parity spec §8.4).
          description: fenceUntrusted("a maintenance ticket's description (written by whoever reported it)", ticket.description, OTHERS_TEXT_NOTE),
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

// ── list_maintenance_due ──────────────────────────────────────────

interface DueTaskEntry {
  id: string;
  title: string;
  /** "General lab upkeep" when the task belongs to no tool. */
  where: string;
  every: string;
  due_on: string;
  state: "overdue" | "due_today" | "upcoming";
  overdue_days: number;
  last_done_on: string | null;
  instructions: string | null;
}

interface ListDueInput {
  within_days?: number;
  tool?: string;
}

const listDueSchema: z.ZodType<ListDueInput> = z.object({
  within_days: z
    .number()
    .int()
    .min(0)
    .max(90)
    .optional()
    .describe("How many days ahead to look. 0 is today and overdue only; default 7"),
  tool: z.string().max(200).optional().describe("Only tasks on this tool: part of its name or its slug"),
});

const listMaintenanceDueTool: CapabilityTool<ListDueInput, { today: string; within_days: number; count: number; tasks: DueTaskEntry[]; page: string }> = {
  name: "list_maintenance_due",
  description:
    "List the lab's recurring maintenance tasks that are overdue or due soon (default: the next 7 days) — the due list on /admin/maintenance — with each task's title, tool and unit (or general lab upkeep), how often it repeats, its due date, days overdue, when it was last done and the lab's instructions. Staff only. Read-only: a task is checked off with Done in the app.",
  inputSchema: listDueSchema,
  kind: "read",
  requiredPermission: "maintenance.manage",
  run: async (input) => {
    const today = labToday();
    const withinDays = input.within_days ?? 7;
    const wanted = input.tool?.trim().toLowerCase() ?? "";
    const items = await listDueSchedules(today, { withinDays });
    const tasks = items
      .filter((item) => !wanted || (item.toolName ?? "").toLowerCase().includes(wanted) || (item.toolSlug ?? "").toLowerCase() === wanted)
      .map(
        (item): DueTaskEntry => ({
          id: item.id,
          title: item.title,
          where: item.toolName ? [item.toolName, item.unitLabel].filter(Boolean).join(" · ") : "General lab upkeep",
          every: `every ${item.interval.count} ${item.interval.unit}${item.interval.count === 1 ? "" : "s"}`,
          due_on: item.nextDueOn,
          state: item.state === "overdue" ? "overdue" : item.state === "today" ? "due_today" : "upcoming",
          overdue_days: item.overdueDays,
          last_done_on: item.lastDoneOn,
          instructions: item.instructions,
        })
      );
    return { today, within_days: withinDays, count: tasks.length, tasks, page: "/admin/maintenance" };
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
  // The chat's `update_ticket` proposes a card instead (parity spec phase 2).
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

    // The adapter stamps the surface; `chatId` is optional client data and is
    // not evidence of anything. Unstamped (a direct caller) reads as MCP, the
    // stricter of the two.
    const surface = ctx.surface === "chat" ? "assistant" : "mcp";
    const result = await writeTicket({ logId: input.ticket_id.trim(), patch }, { identity, surface });
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
- **Changing a ticket is a card the person confirms.** When they ask to change one ("mark it resolved: replaced the tank"), call \`update_ticket\` with the ticket id(s) and the change — it proposes a confirmation card and changes nothing by itself. Several tickets with the same change go in one call. If more than one ticket could be meant, list them and ask which.
- Use the ticket id from \`list_open_tickets\` (call it first if you do not have the id) — never guess an id. Assign only to \`me\` or \`nobody\`; to hand a ticket to someone else, point them to /admin/maintenance.
- **Work already done** ("log maintenance on the WEN: replaced the belt") is \`log_completed_maintenance\` — a resolved log with the person as the one who did it. A problem that still needs fixing is \`report_issue\`.
- **Recurring tasks.** When staff ask what upkeep is due ("what's due today?", "is anything overdue?"), call \`list_maintenance_due\` (\`within_days: 0\` for today and overdue only) and answer from its result: each task's title, where, and its due date or days overdue. If nothing is due, say so plainly. You cannot check a task off: point them to **Done** on /admin/maintenance.
- Resolution notes and logs are always written in **English**, whatever language the conversation is in.`);
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
    listMaintenanceDueTool as unknown as CapabilityTool<unknown, unknown>,
    updateTicketTool as unknown as CapabilityTool<unknown, unknown>,
    mcpProposeTool as unknown as CapabilityTool<unknown, unknown>,
  ],
};
