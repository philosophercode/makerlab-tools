import { z } from "zod";
import type { LanguageModel } from "ai";
import { getCatalogTool } from "../catalog";
import { describeDbError } from "../db/describe-error";
import type { Identity } from "../auth/identity";
import { fileProblemTicket } from "./file-ticket";
import {
  QUICK_REPORT_MIN_OPEN_MS,
  QUICK_REPORT_PHOTOS_MAX,
  QUICK_REPORT_TEXT_MAX,
  QUICK_REPORT_TEXT_MIN,
  QUICK_REPORT_TRAP_FIELD,
} from "./quick-report-limits";
import { REPORT_CATEGORY_LABEL, cleanTitle, triageReport, type Triage, type TriageUnit } from "./quick-report-triage";
import { ticketRef } from "./ticket-ref";

/**
 * The quick report form's server side (quick report spec §5): one box of the
 * student's words in, a normal maintenance ticket out.
 *
 * 1. {@link parseQuickReport} checks the request's shape, its bounds and the
 *    bot check (the hidden field and the time the form was open).
 * 2. {@link fileQuickReport} finds the tool among the published catalogue,
 *    keeps the unit the student chose only when it is one of that tool's,
 *    asks the triage for a title, category, severity and (when no unit was
 *    chosen) a unit, and files the ticket through `fileProblemTicket`, the
 *    write `report_issue` uses. No triage: the report is filed as written.
 *
 * Rate limits are the route's (`POST /api/report`), checked before either.
 */

export type QuickReportError = "invalid_input" | "unknown_tool" | "write_failed";

export interface QuickReport {
  /** The tool's slug (or id). */
  tool: string;
  /** The unit the student chose, or that the scanned label named. Not trusted until it matches. */
  unitId: string | null;
  text: string;
  photoIds: string[];
}

const payloadSchema = z.object({
  tool: z.string().trim().min(1).max(200),
  unit_id: z.string().max(64).nullish(),
  // Checked for length after trimming, below.
  text: z.string().max(QUICK_REPORT_TEXT_MAX * 2),
  photo_attachment_ids: z.array(z.string().max(64)).max(QUICK_REPORT_PHOTOS_MAX).optional(),
  [QUICK_REPORT_TRAP_FIELD]: z.string().max(500).optional(),
  open_ms: z.number().finite().nonnegative(),
});

/** A request body → a {@link QuickReport}, or `invalid_input`. Pure. */
export function parseQuickReport(payload: unknown): { ok: true; report: QuickReport } | { ok: false; code: "invalid_input" } {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const body = parsed.data;
  // The bot check (§8): a hidden field only a form-filling script fills, and a
  // form sent faster than anyone can describe a fault. Refused like any other
  // bad input, so a script learns nothing from the answer.
  if ((body[QUICK_REPORT_TRAP_FIELD] ?? "").trim() !== "") return { ok: false, code: "invalid_input" };
  if (body.open_ms < QUICK_REPORT_MIN_OPEN_MS) return { ok: false, code: "invalid_input" };
  // A typed line break is part of what they said; a run of blank lines is not.
  const text = body.text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < QUICK_REPORT_TEXT_MIN || text.length > QUICK_REPORT_TEXT_MAX) return { ok: false, code: "invalid_input" };
  return {
    ok: true,
    report: { tool: body.tool, unitId: body.unit_id || null, text, photoIds: body.photo_attachment_ids ?? [] },
  };
}

/** The title a report gets with no triage: its first line, cut at a word. Pure. */
export function fallbackTitle(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim()) ?? text;
  const flat = cleanTitle(firstLine, 200);
  if (flat.length <= 80) return flat;
  const cut = flat.slice(0, 80);
  const space = cut.lastIndexOf(" ");
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

type UnitSource = "chosen" | "only" | "guessed" | null;

/**
 * The ticket's description: the student's words as they wrote them, then one
 * line for staff saying where the ticket came from and what was guessed. In
 * English (AGENTS.md: tickets are always written in English); the student's
 * own words stay in theirs. Pure.
 */
export function describeQuickReport(text: string, triage: Triage | null, unitSource: UnitSource): string {
  const notes = ["Sent with the quick report form."];
  if (triage) {
    notes.push(`MakerLAB AI suggested the title, the category (${REPORT_CATEGORY_LABEL[triage.category]}) and the priority.`);
  } else {
    notes.push("MakerLAB AI was not available, so the title is the start of the report and the priority is Medium.");
  }
  if (unitSource === "guessed") notes.push("MakerLAB AI picked the unit from the report.");
  return `${text}\n\n${notes.join(" ")}`;
}

export interface QuickReportFiled {
  /** The ticket's short reference ({@link ticketRef}). */
  ref: string;
  /** The unit the ticket landed on, by name, or null for the tool as a whole. */
  unit: string | null;
}

export interface FileQuickReportOptions {
  /** A triage model to use instead of the job's (tests). */
  model?: LanguageModel;
}

export async function fileQuickReport(
  report: QuickReport,
  identity: Pick<Identity, "userId" | "name" | "email" | "demoPass">,
  options: FileQuickReportOptions = {}
): Promise<{ ok: true; value: QuickReportFiled } | { ok: false; code: QuickReportError }> {
  let tool: Awaited<ReturnType<typeof getCatalogTool>>;
  try {
    tool = await getCatalogTool(report.tool);
  } catch (err) {
    console.error("[quick-report] the catalogue could not be read", describeDbError(err));
    return { ok: false, code: "write_failed" };
  }
  if (!tool) return { ok: false, code: "unknown_tool" };

  const units: TriageUnit[] = tool.units.map((unit) => ({ id: unit.id, name: unit.name }));
  // The student's choice (or the label's) wins, but only among this tool's
  // own units: a unit of another machine is ignored, not trusted.
  const chosen = report.unitId ? units.find((unit) => unit.id === report.unitId) : undefined;
  const only = !chosen && units.length === 1 ? units[0] : undefined;
  const known = chosen ?? only ?? null;

  const triage = await triageReport(
    { text: report.text, toolName: tool.name, units: known ? [] : units },
    { model: options.model }
  );
  const guessed = !known && triage?.unitId ? units.find((unit) => unit.id === triage.unitId) : undefined;
  const unit = known ?? guessed ?? null;
  const unitSource: UnitSource = chosen ? "chosen" : only ? "only" : guessed ? "guessed" : null;

  try {
    const record = await fileProblemTicket({
      title: triage?.title || fallbackTitle(report.text),
      description: describeQuickReport(report.text, triage, unitSource),
      priority: triage?.severity ?? "Medium",
      unitId: unit?.id ?? null,
      // No unit: the ticket still names the machine.
      toolId: tool.id,
      // From the session only. The form has no name or email field, so an
      // anonymous report stays anonymous.
      reportedByName: identity.name || null,
      reportedByEmail: identity.email || null,
      reportedByUserId: identity.userId || null,
      photoAttachmentIds: report.photoIds,
      // The form is a page, not the chat or a connected app (email
      // notifications spec §5.1).
      surface: "gui",
      // A demo pass's report lands flagged, as `report_issue` files it (demo
      // pass spec 2026-10-07 §5.4): from the server-resolved pass only.
      demo: Boolean(identity.demoPass),
    });
    if (report.photoIds.length > 0 && record.photosAttached === 0) {
      console.warn(`[quick-report] ticket ${record.id} filed without its ${report.photoIds.length} photo(s): no upload matched`);
    }
    return { ok: true, value: { ref: ticketRef(record.id), unit: unit?.name ?? null } };
  } catch (err) {
    // The failure's kind only, never the row's values (`describeDbError`).
    console.error("[quick-report] filing a ticket failed", describeDbError(err));
    return { ok: false, code: "write_failed" };
  }
}
