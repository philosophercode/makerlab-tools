import { z } from "zod";
import { getCatalogTools } from "../catalog";
import { createFeedback, type NewFeedback } from "../data/feedback";
import type { FlaggedField } from "../types";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * The `flags` capability: filing catalog corrections ("report a correction",
 * design spec 2026-07-29). Since Phase 3 a correction is a row in the
 * `feedback` table (data platform spec §3.10, §4.9) rather than a page in the
 * Notion `Flags` database — the raw `fetch` §3.10 names for removal is gone,
 * and `src/lib/data/feedback.ts` is the only thing that touches the table.
 *
 * Two surfaces share this module so there is exactly one validation and one
 * write path (constitution Art. 2, spec §3): the assistant calls
 * `report_correction`, and `POST /api/flags` calls {@link parseCorrectionReport}
 * + {@link submitCorrection} directly.
 *
 * A flag is inert by construction (spec §8): it only ever inserts into
 * `feedback`. Nothing here writes to `tools`, `units`, or anything else — the
 * only path from a student's report to the catalog runs through a person on
 * `/admin/corrections`.
 */

// ── Contract ───────────────────────────────────────────────────────

/**
 * The `field_flagged` Select options, in the order they are offered. Mirrored
 * by `FIELD_OPTIONS` in `components/FlagButton.tsx` (a client component cannot
 * import this server-only module); `FlagButton.test.tsx` asserts they match.
 */
export const FLAG_FIELDS = [
  "description",
  "image",
  "name",
  "category",
  "location",
  "materials",
  "safety_info",
] as const satisfies readonly FlaggedField[];

/** Length cap on `issue_description` and `suggested_fix` (spec §8). */
export const MAX_FLAG_TEXT = 2_000;

/** Length cap on the free-text reporter name. */
export const MAX_REPORTER_CHARS = 200;

/**
 * Every way a submission can fail. Surfaces map these to their own messages.
 *
 * `not_configured` is no longer *returned* — the write is local now, and there
 * is no credential that could be missing. It stays in the union and in
 * `FlagButton`'s message map because removing it would be a client change, a
 * translated string retired and a route status table edited, for nothing.
 */
export type FlagErrorCode =
  | "invalid_input"
  | "unknown_tool"
  | "not_configured"
  | "write_failed";

/** A validated, normalized correction report — the input to the write. */
export interface CorrectionReport {
  /** Catalogue id (a Postgres uuid) or slug of the tool the report is about. */
  tool_id: string;
  field_flagged: FlaggedField;
  issue_description: string;
  suggested_fix?: string;
  /** Self-declared name. Untrusted, stored as plain text. */
  reporter?: string;
}

/**
 * The signed-in reporter, when there is one. Deliberately **not** part of
 * {@link CorrectionReport}: a client may not assert its own identity, so
 * `reporter_email` is only ever written from a server-resolved session. Both
 * surfaces resolve one now; an anonymous caller simply has none.
 */
export interface ReporterIdentity {
  name?: string;
  email?: string;
  /** The signed-in user's id, recorded on the row so staff can follow up. */
  userId?: string;
}

/**
 * What gets written. The column shape of one `feedback` row, built by
 * {@link buildFeedbackRow} and inserted by `src/lib/data/feedback.ts`.
 */
export type FeedbackRow = NewFeedback;

export type SubmitCorrectionResult =
  | { ok: true; id: string }
  | { ok: false; code: FlagErrorCode };

// ── Validation (shared by both surfaces) ───────────────────────────

interface ReportCorrectionInput {
  tool_id: string;
  field_flagged: FlaggedField;
  issue_description: string;
  suggested_fix?: string;
  reporter?: string;
}

const reportCorrectionInputSchema: z.ZodType<ReportCorrectionInput> = z.object({
  tool_id: z
    .string()
    .describe("Catalogue id or slug of the tool the report is about"),
  field_flagged: z
    .enum(FLAG_FIELDS)
    .describe("Which field of the catalog entry is wrong"),
  issue_description: z
    .string()
    .max(MAX_FLAG_TEXT)
    .describe("What is wrong, in the student's own words"),
  suggested_fix: z
    .string()
    .max(MAX_FLAG_TEXT)
    .optional()
    .describe("What the field should say instead, if the student knows"),
  reporter: z
    .string()
    .max(MAX_REPORTER_CHARS)
    .optional()
    .describe("Student name if provided; reports may be anonymous"),
});

function trimmed(value: unknown): unknown {
  return typeof value === "string" ? value.trim() : value;
}

/**
 * Normalize and validate an untrusted payload from either surface. Trimming
 * happens before the schema runs so a whitespace-only description is rejected
 * rather than stored (spec §5, "unhappy paths").
 */
export function parseCorrectionReport(
  raw: unknown
): { ok: true; report: CorrectionReport } | { ok: false; code: "invalid_input" } {
  if (typeof raw !== "object" || raw === null) return { ok: false, code: "invalid_input" };

  const source = raw as Record<string, unknown>;
  const parsed = reportCorrectionInputSchema.safeParse({
    tool_id: trimmed(source.tool_id),
    field_flagged: source.field_flagged,
    issue_description: trimmed(source.issue_description),
    suggested_fix: trimmed(source.suggested_fix) || undefined,
    reporter: trimmed(source.reporter) || undefined,
  });

  if (!parsed.success) return { ok: false, code: "invalid_input" };
  if (!parsed.data.tool_id || !parsed.data.issue_description) {
    return { ok: false, code: "invalid_input" };
  }

  return { ok: true, report: parsed.data };
}

/**
 * Build the `feedback` row. Pure — the insert is separate so the `new` status
 * and the `reporter_email`-only-when-signed-in rule stay unit-testable without
 * a database.
 *
 * There is no title to generate any more: `feedback` has no title column, and
 * the `<tool> — <field>` string only ever existed because a Notion page needs
 * one. `/admin/corrections` renders the tool and the field from their own
 * columns.
 */
export function buildFeedbackRow(
  report: CorrectionReport,
  tool: FlaggedTool,
  identity?: ReporterIdentity
): FeedbackRow {
  const row: FeedbackRow = {
    // Always the catalogue uuid, never the slug the caller may have passed:
    // `findTool` resolves either and reports the id.
    toolId: tool.id,
    fieldFlagged: report.field_flagged,
    issueDescription: report.issue_description,
    suggestedFix: report.suggested_fix ?? null,
    reporterName: report.reporter || identity?.name || null,
    reporterEmail: null,
    reporterUserId: identity?.userId ?? null,
  };

  // Only ever from a server-resolved session — never from the request body.
  if (identity?.email) row.reporterEmail = identity.email;

  return row;
}

// ── Submission (shared by both surfaces) ───────────────────────────

/** The tool a report is about. `id` is the catalogue id, a Postgres uuid. */
export interface FlaggedTool {
  id: string;
  name: string;
}

/** Resolve by catalogue id or slug — surfaces disagree about which they hold. */
async function findTool(toolId: string): Promise<FlaggedTool | null> {
  const tools = await getCatalogTools();
  const match = tools.find((tool) => tool.id === toolId || tool.slug === toolId);
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * File a validated report. Never throws and never returns the underlying
 * database error — a failed write is logged server-side and reported to the
 * caller as an opaque `write_failed` (spec §10, "without leaking the error").
 */
export async function submitCorrection(
  report: CorrectionReport,
  identity?: ReporterIdentity
): Promise<SubmitCorrectionResult> {
  try {
    // The catalogue read is inside the try with the write: both are Postgres
    // now, so an unreachable database fails the tool lookup first, and that has
    // to come back as a failed write rather than a thrown promise the caller
    // was not expecting.
    const tool = await findTool(report.tool_id);
    if (!tool) return { ok: false, code: "unknown_tool" };

    const { id } = await createFeedback(buildFeedbackRow(report, tool, identity));
    return { ok: true, id };
  } catch (err) {
    console.error("Flag submission failed", err);
    return { ok: false, code: "write_failed" };
  }
}

// ── report_correction ──────────────────────────────────────────────

interface ReportCorrectionResult {
  success: boolean;
  flag_id?: string;
  message?: string;
  error?: string;
}

/**
 * The capability context's identity as a {@link ReporterIdentity}, or undefined
 * when nobody is signed in. An anonymous identity is present on the context but
 * carries no one, and must not be mistaken for a session.
 */
function identityOf(ctx: CapabilityCtx): ReporterIdentity | undefined {
  const identity = ctx.identity;
  if (!identity || (!identity.email && !identity.userId)) return undefined;
  return {
    name: identity.name ?? undefined,
    email: identity.email ?? undefined,
    userId: identity.userId ?? undefined,
  };
}

/** Model-facing failure text. Opaque by design — no database detail escapes. */
const FAILURE_MESSAGES: Record<FlagErrorCode, string> = {
  invalid_input: "A tool and a description of the problem are required.",
  unknown_tool: "That tool is not in the catalog.",
  not_configured: "Corrections are not configured yet.",
  write_failed: "The correction could not be filed. Try again shortly.",
};

const reportCorrection: CapabilityTool<ReportCorrectionInput, ReportCorrectionResult> = {
  name: "report_correction",
  description:
    "File a correction against a catalog entry when a student says something on a tool's page is wrong. Confirm which field is wrong and what it should say before calling this — a flag filed on ambiguous intent is noise staff have to clear. The flag is staff-facing only and never changes the catalog.",
  inputSchema: reportCorrectionInputSchema,
  kind: "write",
  async run(
    input: ReportCorrectionInput,
    ctx: CapabilityCtx
  ): Promise<ReportCorrectionResult> {
    const parsed = parseCorrectionReport({
      ...input,
      // Fall back to the tool whose page the student is reading.
      tool_id: input.tool_id || ctx.focusedToolId || "",
    });
    if (!parsed.ok) {
      return { success: false, error: "A tool and a description of the problem are required." };
    }

    // The session, when the surface resolved one — the same rule `report_issue`
    // follows: a client may never assert its own identity, so `reporter_email`
    // and `reporter_user_id` come from `ctx.identity` and nowhere else. MCP and
    // scheduled callers have no identity, and anonymous stays the default (§8).
    const result = await submitCorrection(parsed.report, identityOf(ctx));
    if (!result.ok) {
      return { success: false, error: FAILURE_MESSAGES[result.code] };
    }

    return {
      success: true,
      flag_id: result.id,
      message: `Filed correction ${result.id} for review.`,
    };
  },
};

// ── Prompt fragment ────────────────────────────────────────────────

function promptFragment(): string {
  return `## Reporting catalog corrections

The catalog is maintained by hand and partly drafted by an AI intake flow, so some of it is wrong. When a student disputes a fact about a tool — the build volume, the room it lives in, a dead manual link, the wrong photo — you can file a correction for staff with \`report_correction\`.

Wait to be asked, or offer once and drop it. Do not file one on your own initiative.

Before calling it, confirm two things back to the student in their own words: **which field** is wrong (\`description\`, \`image\`, \`name\`, \`category\`, \`location\`, \`materials\`, or \`safety_info\`) and **what it should say instead**, if they know. Pass the tool's id as \`tool_id\`. Ask for their name only if they volunteer one — reports may be anonymous.

A correction never changes the catalog. It creates a note staff read in the app, so tell the student it was passed on for review — and do not promise them a reply.`;
}

// ── Capability ─────────────────────────────────────────────────────

export const flags: Capability = {
  id: "flags",
  promptFragment,
  tools: [reportCorrection as CapabilityTool<unknown, unknown>],
};
