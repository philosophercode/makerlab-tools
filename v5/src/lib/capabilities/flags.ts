import { z } from "zod";
import { getCatalogTools } from "../catalog";
import type { FlagFields, FlaggedField } from "../types";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * The `flags` capability: filing catalog corrections ("report a correction",
 * design spec 2026-07-29). The `Flags` Notion database already existed and was
 * unused — this connects it.
 *
 * Two surfaces share this module so there is exactly one validation and one
 * write path (constitution Art. 2, spec §3): the assistant calls
 * `report_correction`, and `POST /api/flags` calls {@link parseCorrectionReport}
 * + {@link submitCorrection} directly.
 *
 * A flag is inert by construction (spec §8): it only ever creates a row in the
 * Flags database. Nothing here writes to Tools, Units, or anything else — the
 * only path from a student's report to the catalog runs through a human in
 * Notion.
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

/** Every way a submission can fail. Surfaces map these to their own messages. */
export type FlagErrorCode =
  | "invalid_input"
  | "unknown_tool"
  | "not_configured"
  | "write_failed";

/** A validated, normalized correction report — the input to the write. */
export interface CorrectionReport {
  /** Notion page id (or slug) of the tool the report is about. */
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
 * `reporter_email` is only ever written from a server-resolved session. No
 * surface passes one yet — that lands with the auth spec (spec §4, §9.4).
 */
export interface ReporterIdentity {
  name?: string;
  email?: string;
}

/**
 * What gets written to the Flags database. `reporter_email` is not on
 * `FlagFields` yet because the Notion property is new (spec §4); it rides
 * alongside until `types.ts` catches up.
 */
export type FlagWriteFields = Partial<FlagFields> & { reporter_email?: string };

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
    .describe("Notion page id (or slug) of the tool the report is about"),
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
 * Build the Flags row. Pure — the Notion call is separate so title generation,
 * the `New` status, and the `reporter_email`-only-when-signed-in rule are all
 * unit-testable without touching the network.
 */
export function buildFlagFields(
  report: CorrectionReport,
  tool: { id: string; name: string },
  identity?: ReporterIdentity
): FlagWriteFields {
  const fields: FlagWriteFields = {
    title: `${tool.name} — ${report.field_flagged}`,
    tool: [tool.id],
    field_flagged: report.field_flagged,
    issue_description: report.issue_description,
    status: "New",
  };

  if (report.suggested_fix) fields.suggested_fix = report.suggested_fix;

  const reporter = report.reporter || identity?.name;
  if (reporter) fields.reporter = reporter;
  // Only ever from a server-resolved session — never from the request body.
  if (identity?.email) fields.reporter_email = identity.email;

  return fields;
}

// ── Notion write ───────────────────────────────────────────────────

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/** True when the Flags database is configured. Reads are unaffected. */
export function hasFlagsEnv(): boolean {
  return Boolean(process.env.NOTION_API_KEY && process.env.NOTION_DB_FLAGS);
}

type NotionWriteProperty = Record<string, unknown>;

function richText(value: string): NotionWriteProperty {
  return { rich_text: [{ text: { content: value } }] };
}

/**
 * Create one page in the Flags database. Deliberately scoped to that single
 * database id — there is no code path here that can address another one.
 */
async function createFlagPage(fields: FlagWriteFields): Promise<string> {
  const apiKey = process.env.NOTION_API_KEY as string;
  const databaseId = process.env.NOTION_DB_FLAGS as string;

  const properties: Record<string, NotionWriteProperty> = {
    title: { title: [{ text: { content: fields.title || "Correction report" } }] },
    status: { select: { name: fields.status || "New" } },
  };
  if (fields.field_flagged) {
    properties.field_flagged = { select: { name: fields.field_flagged } };
  }
  if (fields.tool?.length) {
    properties.tool = { relation: fields.tool.map((id) => ({ id })) };
  }
  if (fields.issue_description) {
    properties.issue_description = richText(fields.issue_description);
  }
  if (fields.suggested_fix) {
    properties.suggested_fix = richText(fields.suggested_fix);
  }
  if (fields.reporter) {
    properties.reporter = richText(fields.reporter);
  }
  if (fields.reporter_email) {
    properties.reporter_email = { email: fields.reporter_email };
  }

  const res = await fetch(`${NOTION_API_URL}/pages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
    }),
  });

  if (!res.ok) {
    // Body is read for the server log only; it never reaches the caller.
    const body = await res.text().catch(() => "");
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  const page = (await res.json()) as { id?: string };
  if (!page.id) throw new Error("Notion API returned no page id");
  return page.id;
}

// ── Submission (shared by both surfaces) ───────────────────────────

/** Resolve by Notion page id or slug — surfaces disagree about which they hold. */
async function findTool(toolId: string): Promise<{ id: string; name: string } | null> {
  const tools = await getCatalogTools();
  const match = tools.find((tool) => tool.id === toolId || tool.slug === toolId);
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * File a validated report. Never throws and never returns the underlying Notion
 * error — a failed write is logged server-side and reported to the caller as an
 * opaque `write_failed` (spec §10, "without leaking the Notion error").
 */
export async function submitCorrection(
  report: CorrectionReport,
  identity?: ReporterIdentity
): Promise<SubmitCorrectionResult> {
  if (!hasFlagsEnv()) return { ok: false, code: "not_configured" };

  const tool = await findTool(report.tool_id);
  if (!tool) return { ok: false, code: "unknown_tool" };

  try {
    const id = await createFlagPage(buildFlagFields(report, tool, identity));
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

/** Model-facing failure text. Opaque by design — no Notion detail escapes. */
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

    // No `identity` yet: nothing resolves a session server-side until the auth
    // spec lands, so reports filed through chat stay anonymous (spec §9.4).
    const result = await submitCorrection(parsed.report);
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

A correction never changes the catalog. It creates a note staff read in Notion, so tell the student it was passed on for review — and do not promise them a reply.`;
}

// ── Capability ─────────────────────────────────────────────────────

export const flags: Capability = {
  id: "flags",
  promptFragment,
  tools: [reportCorrection as CapabilityTool<unknown, unknown>],
};
