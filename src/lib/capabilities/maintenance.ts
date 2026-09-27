import { z } from "zod";
import { getCatalogTools } from "../catalog";
import { createMaintenanceLog } from "../data/maintenance";
import { buildUnitLookup, findUnit } from "./helpers";
import type {
  Capability,
  CapabilityCtx,
  CapabilityTool,
  PromptEnv,
} from "./types";

/**
 * The `maintenance` capability: filing maintenance tickets from chat (and now
 * MCP). Ported byte-for-byte from the chat route's `report_issue` tool and its
 * "Reporting maintenance issues" system-prompt section (design spec §3.4, §7).
 *
 * Two things have since changed:
 *
 * - **Authorship.** When `ctx.identity` carries a signed-in caller, the ticket
 *   records that name and email rather than whatever the conversation supplied
 *   (auth spec §3.4, §9.5). Verified authorship is one of the reasons sign-in
 *   exists. Anonymous reporting still works exactly as it did in the chat.
 *   Over MCP the tool is offered only to a signed-in caller (a personal
 *   access token or an OAuth grant — MCP access spec §3.2), so a ticket filed
 *   there always carries a verified name.
 * - **The ticket lands in Postgres** (data platform spec §3.10, §4.8), not in
 *   a Notion page. The capability no longer knows anything about Notion: it
 *   resolves the unit against the catalogue, hands a validated ticket to
 *   `src/lib/data/maintenance.ts`, and reports what came back. A write that
 *   throws is reported to the student as a ticket that did **not** land — the
 *   one thing this path may never get wrong (Article 4).
 */

const PRIORITIES = ["Critical", "High", "Medium", "Low"] as const;

// ── report_issue ───────────────────────────────────────────────────

interface ReportIssueInput {
  title: string;
  description: string;
  unit_label?: string;
  priority: (typeof PRIORITIES)[number];
  reported_by?: string;
  photo_attachment_ids?: string[];
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
    .describe(
      "Student name or NetID if they gave one. Ignored when the student is signed in — the verified name from their session is recorded instead."
    ),
  photo_attachment_ids: z
    .array(z.string())
    .optional()
    .describe(
      "Attachment ids of photos the student uploaded. Parse the attachment_id values out of the [Attached photos: ...] hint in their message."
    ),
});

/**
 * What the model is told when photos were offered and none of them attached.
 *
 * English on purpose: it is appended to the ticket-result message the assistant
 * paraphrases for the student, and the assistant answers in their language
 * (Article 6 — the *ticket itself* is the English exception, this is a hint to
 * the model, not a string shown to a person).
 */
const PHOTOS_NOT_ATTACHED =
  "The photos could not be attached to this ticket — tell the student the report was filed without them and to describe what the photo showed if it matters.";

const reportIssue: CapabilityTool<ReportIssueInput, ReportIssueResult> = {
  name: "report_issue",
  description:
    "File a maintenance ticket in the app when a student reports a problem with a tool or unit. Gather a short title and a clear description first. If they named a specific unit (like 'Prusa #1'), include it so the log is linked. Ask for the reporter's name only when nobody is signed in — a signed-in student's verified name is recorded automatically.",
  inputSchema: reportIssueInputSchema,
  kind: "write",
  async run(input: ReportIssueInput, ctx: CapabilityCtx): Promise<ReportIssueResult> {
    const { title, description, unit_label, priority, reported_by } = input;
    // Already uuids: `POST /api/uploads` hands out `attachments.id`s, and the
    // data layer claims them onto the new ticket. Anything else is dropped
    // there rather than reaching a uuid column.
    const photoIds = input.photo_attachment_ids ?? [];

    // The catalogue read is inside the try with the write: an unreachable
    // database fails the label lookup first, and a thrown tool call is a worse
    // answer than a reported failure — the student has to be told the report
    // did not land.
    try {
      const tools = await getCatalogTools();
      const unitLookup = buildUnitLookup(tools);
      const match = unit_label ? findUnit(unitLookup, unit_label) : null;

      const record = await createMaintenanceLog({
        title,
        description,
        // The capability speaks Notion's display casing because that is what
        // the input schema was written against; the data module maps it down to
        // the stored vocabulary (`issue_report`, `medium`, `open`).
        type: "Issue Report",
        priority,
        status: "Open",
        // The catalogue id is a Postgres uuid, and so is `unit_id` — no
        // translation left to do. An unresolved label files an unlinked
        // ticket, which is normal: most live logs have no unit at all.
        unitId: match?.id ?? null,
        // The session wins over the model's `reported_by`. A client may never
        // assert its own identity, and a ticket that says who actually filed it
        // is the reason sign-in was worth building.
        reportedByName: ctx.identity?.name || reported_by || null,
        // Server-resolved only. There is no input field for this, and there is
        // deliberately no path that would let one exist.
        reportedByEmail: ctx.identity?.email || null,
        reportedByUserId: ctx.identity?.userId || null,
        photoAttachmentIds: photoIds,
      });

      // Photos offered but none claimed: say so rather than let the student
      // believe staff can see the picture they took (Article 4). Until the
      // upload route moves to Blob this is the normal case, because the ids in
      // the hint are still Notion file_upload ids and no `attachments` row
      // answers to them.
      const photosLost = photoIds.length > 0 && record.photosAttached === 0;
      if (photosLost) {
        console.warn(
          `[maintenance] ticket ${record.id} filed without its ${photoIds.length} photo(s) — no attachment matched the ids supplied`
        );
      }

      return {
        success: true,
        ticket_id: record.id,
        unit_resolved: match ? { id: match.id, label: match.label } : null,
        message: photosLost
          ? `Logged maintenance ticket ${record.id}. ${PHOTOS_NOT_ATTACHED}`
          : `Logged maintenance ticket ${record.id}.`,
      };
    } catch (err) {
      // The database's own words never reach the model: a driver message can
      // carry a connection string, and nothing the student can do with it is
      // useful. The detail stays in the server log.
      console.error("[maintenance] filing a ticket failed", err);
      return {
        success: false,
        error:
          "The ticket could not be filed and nothing was recorded. Tell the student to try again shortly, or to find staff if it is urgent.",
      };
    }
  },
};

// ── Prompt fragment ────────────────────────────────────────────────

/**
 * Names reach the system prompt from Google, so they are escaped and capped
 * before they get there (auth spec §8). Strip newlines and the markdown
 * characters that could close a span or open something that reads as a new
 * instruction — a display name is not an instruction channel. Emails never
 * appear in the prompt at all.
 */
function promptSafeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*_#[\]<>{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

function promptFragment(env: PromptEnv): string {
  const signedInName = promptSafeName(env.identity?.name);
  const reporterLine = signedInName
    ? `The student is signed in as **${signedInName}**, so do not ask who they are — \`report_issue\` records their verified name and email from the session automatically. Leave \`reported_by\` empty; anything you put there is ignored.`
    : `Nobody is signed in, so ask for the student's name or NetID and pass it as \`reported_by\`. If they would rather not give one, file the ticket anyway — an anonymous report still beats an unreported fault.`;

  return `## Reporting maintenance issues

You are a first-line helper, not a ticket-creation machine. Follow this order:

1. **Diagnose conversationally first.** When a student describes a problem, ask a clarifying question or two and walk them through quick fixes they can likely do themselves — swap the filament, re-level the bed, clear a jam, restart the slicer, replace a worn bit, check the e-stop, power-cycle, reseat cables, re-home axes, etc. Start with the simplest plausible fix and escalate from there.
2. **Recognize when to escalate.** Move toward filing a ticket if: the issue is unsafe, the tool clearly needs staff intervention, the student says they can't fix it, the problem keeps recurring, or the student explicitly asks to log it.
3. **Proactively offer to log.** Even after a successful self-fix for things staff should know about (jams, low filament, missing parts, anything that affects the next user), gently offer: "Want me to log a quick note so staff knows this happened?" Don't push — just offer.
4. **Gather details and file.** Once the student agrees (or asks directly), collect: a short title, a clear description of what's wrong and what's already been tried, the affected unit if any, and a priority. If they named a specific unit you don't recognize, call \`get_unit_details\` first to verify it exists. Then call \`report_issue\`. After it succeeds, tell the student the ticket was filed and include the ticket ID. If they only name a tool (not a specific unit), it's fine to file without one — but ask first if they can tell you which unit.

**Who is reporting.** ${reporterLine}

If the student's message includes a hint like \`[Attached photos: attachment_id=<id> name=<name>; ...]\`, pass each \`attachment_id\` value as the \`photo_attachment_ids\` argument to \`report_issue\` (do not echo the raw hint back to the student). If the tool result says the photos could not be attached, tell the student the ticket was filed without them rather than implying staff can see the picture.

Priority guide: Critical = unsafe or blocks all lab use · High = tool unusable · Medium = degraded performance · Low = cosmetic.`;
}

// ── Capability ─────────────────────────────────────────────────────

export const maintenance: Capability = {
  id: "maintenance",
  promptFragment,
  tools: [reportIssue as CapabilityTool<unknown, unknown>],
};
