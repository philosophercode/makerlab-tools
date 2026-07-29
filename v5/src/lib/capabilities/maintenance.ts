import { z } from "zod";
import { getCatalogTools } from "../catalog";
import { createMaintenanceLog } from "../notion";
import { buildUnitLookup, findUnit } from "./helpers";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * The `maintenance` capability: filing maintenance tickets from chat (and now
 * MCP). Ported byte-for-byte from the chat route's `report_issue` tool and its
 * "Reporting maintenance issues" system-prompt section (design spec §3.4, §7).
 * Behavior is intentionally unchanged.
 */

const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

// ── report_issue ───────────────────────────────────────────────────

interface ReportIssueInput {
  title: string;
  description: string;
  unit_label?: string;
  priority: (typeof PRIORITIES)[number];
  reported_by?: string;
  photo_uploads?: Array<{ id: string; name: string }>;
}

interface ReportIssueResult {
  success: boolean;
  ticket_id?: string;
  unit_resolved?: { id: string; label: string } | null;
  message?: string;
  error?: string;
}

const reportIssueInputSchema: z.ZodType<ReportIssueInput> = z.object({
  title: z.string().describe("Short summary of the issue"),
  description: z.string().describe("Full description of what's wrong"),
  unit_label: z
    .string()
    .optional()
    .describe("Unit label if the issue is tied to a specific unit"),
  priority: z
    .enum(PRIORITIES)
    .default("Medium")
    .describe(
      "Critical = unsafe / lab-blocking, High = unusable, Medium = degraded, Low = cosmetic"
    ),
  reported_by: z
    .string()
    .optional()
    .describe("Student name or NetID if provided"),
  photo_uploads: z
    .array(
      z.object({
        id: z.string().describe("Notion file_upload_id"),
        name: z.string().describe("Original filename"),
      })
    )
    .optional()
    .describe(
      "Notion file_upload references. Parse these from the [Attached photos: file_upload_id=... name=...] hint in the student's message."
    ),
});

const reportIssue: CapabilityTool<ReportIssueInput, ReportIssueResult> = {
  name: "report_issue",
  description:
    "File a maintenance ticket in Notion when a student reports a problem with a tool or unit. Gather a short title and a clear description first. If they named a specific unit (like 'Prusa #1'), include it so the log is linked. Ask for the reporter's name if they haven't given it.",
  inputSchema: reportIssueInputSchema,
  kind: "write",
  async run(input: ReportIssueInput, _ctx: CapabilityCtx): Promise<ReportIssueResult> {
    const { title, description, unit_label, priority, reported_by, photo_uploads } =
      input;
    const tools = await getCatalogTools();
    const unitLookup = buildUnitLookup(tools);
    const match = unit_label ? findUnit(unitLookup, unit_label) : null;
    try {
      const record = await createMaintenanceLog({
        title,
        description,
        type: "Issue Report",
        priority,
        status: "Open",
        reported_by: reported_by || undefined,
        unit: match ? [match.id] : undefined,
        date_reported: new Date().toISOString().split("T")[0],
        photo_uploads: photo_uploads?.length ? photo_uploads : undefined,
      });
      return {
        success: true,
        ticket_id: record.id,
        unit_resolved: match ? { id: match.id, label: match.label } : null,
        message: `Logged maintenance ticket ${record.id}.`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to file ticket";
      return { success: false, error: message };
    }
  },
};

// ── Prompt fragment ────────────────────────────────────────────────

function promptFragment(): string {
  return `## Reporting maintenance issues

You are a first-line helper, not a ticket-creation machine. Follow this order:

1. **Diagnose conversationally first.** When a student describes a problem, ask a clarifying question or two and walk them through quick fixes they can likely do themselves — swap the filament, re-level the bed, clear a jam, restart the slicer, replace a worn bit, check the e-stop, power-cycle, reseat cables, re-home axes, etc. Start with the simplest plausible fix and escalate from there.
2. **Recognize when to escalate.** Move toward filing a ticket if: the issue is unsafe, the tool clearly needs staff intervention, the student says they can't fix it, the problem keeps recurring, or the student explicitly asks to log it.
3. **Proactively offer to log.** Even after a successful self-fix for things staff should know about (jams, low filament, missing parts, anything that affects the next user), gently offer: "Want me to log a quick note so staff knows this happened?" Don't push — just offer.
4. **Gather details and file.** Once the student agrees (or asks directly), collect: a short title, a clear description of what's wrong and what's already been tried, the affected unit if any, a priority, and the student's name/NetID. If they named a specific unit you don't recognize, call \`get_unit_details\` first to verify it exists. Then call \`report_issue\`. After it succeeds, tell the student the ticket was filed and include the ticket ID. If they only name a tool (not a specific unit), it's fine to file without one — but ask first if they can tell you which unit.

If the student's message includes a hint like \`[Attached photos: file_upload_id=<id> name=<name>; ...]\`, parse each \`file_upload_id\` and \`name\` pair and pass them as the \`photo_uploads\` argument to \`report_issue\` (do not echo the raw hint back to the student). The IDs are already uploaded to Notion and will be attached to the ticket.

Priority guide: Critical = unsafe or blocks all lab use · High = tool unusable · Medium = degraded performance · Low = cosmetic.`;
}

// ── Capability ─────────────────────────────────────────────────────

export const maintenance: Capability = {
  id: "maintenance",
  promptFragment,
  tools: [reportIssue as CapabilityTool<unknown, unknown>],
};
