import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { feedback, maintenanceLogs, pendingTools, projects, tools, units } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * The rows an action is about, read by id — for the confirmation card's
 * preview and for the chat's page context (assistant–GUI parity spec §3.2,
 * §3.6). Every name the card or the prompt shows comes from here, never from
 * the model or the browser: a client names ids, the server says what they are.
 *
 * Batch reads, one statement each, capped by the caller (a selection is at
 * most 50, a proposal batch at most 20). Ids that are not uuids are dropped
 * before they reach a uuid column; ids that name nothing are simply absent.
 *
 * Relative imports with `.ts` extensions, like every module under `data/`.
 */

export interface SubjectReadOptions {
  db?: Db;
}

function uuids(ids: readonly string[]): string[] {
  return [...new Set(ids.filter(isUuid))];
}

// ── Maintenance tickets ─────────────────────────────────────────────

export interface TicketSubject {
  id: string;
  title: string;
  /** The live tool name, else the snapshot. Empty when the ticket names none. */
  toolName: string;
  unitLabel: string;
  status: string;
  priority: string | null;
  assignedToName: string;
  resolution: string;
  /** The reporter's words — untrusted text, fenced wherever it reaches a prompt. */
  description: string;
}

export async function ticketSubjects(ids: readonly string[], options: SubjectReadOptions = {}): Promise<TicketSubject[]> {
  const valid = uuids(ids);
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: maintenanceLogs.id,
      title: maintenanceLogs.title,
      liveToolName: tools.name,
      snapshotToolName: maintenanceLogs.toolName,
      unitLabel: maintenanceLogs.unitLabel,
      status: maintenanceLogs.status,
      priority: maintenanceLogs.priority,
      assignedToName: maintenanceLogs.assignedToName,
      resolution: maintenanceLogs.resolution,
      description: maintenanceLogs.description,
    })
    .from(maintenanceLogs)
    .leftJoin(tools, eq(maintenanceLogs.toolId, tools.id))
    .where(inArray(maintenanceLogs.id, valid));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    toolName: row.liveToolName || row.snapshotToolName || "",
    unitLabel: row.unitLabel || "",
    status: row.status,
    priority: row.priority,
    assignedToName: row.assignedToName || "",
    resolution: row.resolution || "",
    description: row.description || "",
  }));
}

// ── Corrections ─────────────────────────────────────────────────────

export interface CorrectionSubject {
  id: string;
  toolName: string;
  fieldFlagged: string | null;
  /** What the reporter wrote — untrusted text. */
  issueDescription: string;
  status: string;
}

export async function correctionSubjects(ids: readonly string[], options: SubjectReadOptions = {}): Promise<CorrectionSubject[]> {
  const valid = uuids(ids);
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      id: feedback.id,
      toolName: tools.name,
      fieldFlagged: feedback.fieldFlagged,
      issueDescription: feedback.issueDescription,
      status: feedback.status,
    })
    .from(feedback)
    .leftJoin(tools, eq(feedback.toolId, tools.id))
    .where(inArray(feedback.id, valid));
  return rows.map((row) => ({ ...row, toolName: row.toolName || "" }));
}

// ── Projects ────────────────────────────────────────────────────────

export interface ProjectSubject {
  id: string;
  title: string;
  authorName: string;
  published: boolean;
}

export async function projectSubjects(ids: readonly string[], options: SubjectReadOptions = {}): Promise<ProjectSubject[]> {
  const valid = uuids(ids);
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({ id: projects.id, title: projects.title, authorName: projects.authorName, published: projects.published })
    .from(projects)
    .where(inArray(projects.id, valid));
  return rows.map((row) => ({ ...row, authorName: row.authorName || "" }));
}

// ── Tools and units ─────────────────────────────────────────────────

export interface ToolSubject {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  archived: boolean;
}

function toToolSubject(row: { id: string; slug: string; name: string; published: boolean; archivedAt: Date | null }): ToolSubject {
  return { id: row.id, slug: row.slug, name: row.name, published: row.published, archived: row.archivedAt !== null };
}

const TOOL_COLUMNS = { id: tools.id, slug: tools.slug, name: tools.name, published: tools.published, archivedAt: tools.archivedAt };

export async function toolSubjects(ids: readonly string[], options: SubjectReadOptions = {}): Promise<ToolSubject[]> {
  const valid = uuids(ids);
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  const rows = await db.select(TOOL_COLUMNS).from(tools).where(inArray(tools.id, valid));
  return rows.map(toToolSubject);
}

/**
 * One tool by id or slug — drafts included, archived tools not: equipment
 * that has left the lab takes no new maintenance. Null for anything else.
 */
export async function findActiveToolByRef(ref: string, options: SubjectReadOptions = {}): Promise<ToolSubject | null> {
  const value = ref.trim();
  if (!value || value.length > 200) return null;
  const db = options.db ?? (await getDb());
  const match = isUuid(value) ? or(eq(tools.id, value), eq(tools.slug, value)) : eq(tools.slug, value);
  const [row] = await db
    .select(TOOL_COLUMNS)
    .from(tools)
    .where(and(match, isNull(tools.archivedAt)))
    .limit(1);
  return row ? toToolSubject(row) : null;
}

/** One unit, only if it belongs to `toolId`; null otherwise. */
export async function findUnitOfTool(
  toolId: string,
  unitId: string,
  options: SubjectReadOptions = {}
): Promise<{ id: string; label: string } | null> {
  if (!isUuid(toolId) || !isUuid(unitId)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ id: units.id, label: units.unitLabel })
    .from(units)
    .where(and(eq(units.id, unitId), eq(units.toolId, toolId)))
    .limit(1);
  return row ?? null;
}

// ── Pending items ───────────────────────────────────────────────────

export interface PendingSubject {
  id: string;
  name: string;
  brand: string | null;
  status: string;
  createdBy: string | null;
  /** The bulk import it came from, or null for the chat's items. */
  importId: string | null;
}

export async function pendingSubjects(ids: readonly string[], options: SubjectReadOptions = {}): Promise<PendingSubject[]> {
  const valid = uuids(ids);
  if (valid.length === 0) return [];
  const db = options.db ?? (await getDb());
  return db
    .select({
      id: pendingTools.id,
      name: pendingTools.name,
      brand: pendingTools.brand,
      status: pendingTools.status,
      createdBy: pendingTools.createdBy,
      importId: pendingTools.importId,
    })
    .from(pendingTools)
    .where(inArray(pendingTools.id, valid));
}
