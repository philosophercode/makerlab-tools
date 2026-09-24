import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import {
  attachments,
  categories,
  researchRequests,
  resources,
  toolRefreshes,
  tools,
} from "../db/schema/index.ts";
import { OPEN_REFRESH_STATUS, REFRESH_STATUS, isOneOf, type RefreshStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { parseResearchResult, researchResultSchema, type ResearchResult } from "../research/result.ts";
import { fieldProposalsSchema, parseProposals, type FieldProposal } from "../refresh/types.ts";
import { countResearchRequestedSince } from "./pending-tools.ts";
import { revisionOf, type Revision } from "./revision.ts";
import { isUuid } from "./uuid.ts";

/**
 * `tool_refreshes` — refresh research of existing tools (refresh research spec
 * §4.1, §5).
 *
 * The shape follows `pending-tools.ts`: every transition is one conditional
 * statement that names the state it moves from, and every write a research
 * step makes also requires the row to carry **its run's request id**, so a
 * run the row was taken from cannot write to it.
 *
 * Nothing here touches a tool. Accepting a proposal is the tool editor's save
 * path (`lib/refresh/apply.ts`); this module only records what was decided.
 *
 * Relative imports with `.ts` extensions, no `"server-only"`: the refresh
 * workflow's steps load it under plain Node.
 */

export interface ToolRefresh {
  id: string;
  toolId: string;
  status: RefreshStatus;
  requestId: string;
  baseRevision: Revision;
  note: string | null;
  includeDescription: boolean;
  research: ResearchResult | null;
  proposals: FieldProposal[] | null;
  researchError: string | null;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RefreshOptions {
  db?: Db;
}

/** A run that has held a refresh this long is taken to have died (the same day intake uses). */
export const REFRESH_ABANDONED_AFTER_MS = 24 * 60 * 60_000;

/** Why an abandoned refresh failed — what the review list says about it. */
export const ABANDONED_REFRESH_MESSAGE = "Refresh did not finish within a day; the run was abandoned. Refresh again.";

const MAX_ERROR_LENGTH = 1000;

// ── Reading ─────────────────────────────────────────────────────────

export async function getRefresh(id: string, options: RefreshOptions = {}): Promise<ToolRefresh | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db.select().from(toolRefreshes).where(eq(toolRefreshes.id, id));
  return row ? toRefresh(row) : null;
}

/** The latest refresh of a tool, open or not — `null` when it was never refreshed. */
export async function getLatestRefreshForTool(toolId: string, options: RefreshOptions = {}): Promise<ToolRefresh | null> {
  if (!isUuid(toolId)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select()
    .from(toolRefreshes)
    .where(eq(toolRefreshes.toolId, toolId))
    .orderBy(desc(toolRefreshes.createdAt))
    .limit(1);
  return row ? toRefresh(row) : null;
}

/** One row of `/admin/refresh`: the refresh and the tool it is about. */
export interface RefreshQueueRow extends ToolRefresh {
  toolName: string;
  toolSlug: string;
  toolPublished: boolean;
  toolArchived: boolean;
}

/**
 * The review list: every open refresh and every failed one (a failure is
 * waiting for **Refresh again**), newest first — the page orders them by what
 * matters (`refreshRank`). Decided refreshes are history and stay off it.
 */
export async function listRefreshQueue(options: RefreshOptions = {}): Promise<RefreshQueueRow[]> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({
      refresh: toolRefreshes,
      toolName: tools.name,
      toolSlug: tools.slug,
      toolPublished: tools.published,
      toolArchivedAt: tools.archivedAt,
    })
    .from(toolRefreshes)
    .innerJoin(tools, eq(tools.id, toolRefreshes.toolId))
    .where(inArray(toolRefreshes.status, [...OPEN_REFRESH_STATUS, "failed"]))
    .orderBy(desc(toolRefreshes.createdAt));
  // A failed refresh a later one superseded is not waiting for anybody.
  const latest = new Map<string, true>();
  const out: RefreshQueueRow[] = [];
  for (const row of rows) {
    if (latest.has(row.refresh.toolId)) continue;
    latest.set(row.refresh.toolId, true);
    out.push({
      ...toRefresh(row.refresh),
      toolName: row.toolName,
      toolSlug: row.toolSlug,
      toolPublished: row.toolPublished,
      toolArchived: row.toolArchivedAt !== null,
    });
  }
  return out;
}

/** Tool id → its open refresh's id, for the inventory's "Refresh open" tag. */
export async function openRefreshesByTool(options: RefreshOptions = {}): Promise<Map<string, string>> {
  const db = options.db ?? (await getDb());
  const rows = await db
    .select({ id: toolRefreshes.id, toolId: toolRefreshes.toolId })
    .from(toolRefreshes)
    .where(inArray(toolRefreshes.status, [...OPEN_REFRESH_STATUS]));
  return new Map(rows.map((row) => [row.toolId, row.id]));
}

/** How many refreshes have proposals waiting — the `/admin` index's count. */
export async function countRefreshesWaiting(options: RefreshOptions = {}): Promise<number> {
  const db = options.db ?? (await getDb());
  const [row] = await db.select({ n: count() }).from(toolRefreshes).where(eq(toolRefreshes.status, "proposed"));
  return Number(row?.n ?? 0);
}

/**
 * What refresh compares research with, and what the accept path writes over:
 * the tool's own fields, its category's name (a research *hint*), its
 * resources' URLs, whether it has a cover photo, and its revision.
 */
export interface RefreshSubject {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  materials: string[];
  tags: string[];
  trainingRequired: boolean;
  useRestrictions: string | null;
  emergencyStop: string | null;
  floorCheck: string | null;
  published: boolean;
  archived: boolean;
  categoryName: string | null;
  resourceUrls: string[];
  hasCover: boolean;
  revision: Revision;
}

export async function loadRefreshSubject(toolId: string, options: RefreshOptions = {}): Promise<RefreshSubject | null> {
  if (!isUuid(toolId)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      description: tools.description,
      materials: tools.materials,
      tags: tools.tags,
      trainingRequired: tools.trainingRequired,
      useRestrictions: tools.useRestrictions,
      emergencyStop: tools.emergencyStop,
      floorCheck: tools.floorCheck,
      published: tools.published,
      archivedAt: tools.archivedAt,
      categoryName: categories.name,
      revision: revisionOf(tools.updatedAt),
    })
    .from(tools)
    .leftJoin(categories, eq(categories.id, tools.categoryId))
    .where(eq(tools.id, toolId));
  if (!row) return null;
  const [links, covers] = await Promise.all([
    db.select({ url: resources.url }).from(resources).where(eq(resources.toolId, toolId)),
    db
      .select({ n: count() })
      .from(attachments)
      .where(and(eq(attachments.ownerType, "tool"), eq(attachments.ownerId, toolId), eq(attachments.access, "public"))),
  ]);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    materials: row.materials ?? [],
    tags: row.tags ?? [],
    trainingRequired: row.trainingRequired,
    useRestrictions: row.useRestrictions,
    emergencyStop: row.emergencyStop,
    floorCheck: row.floorCheck,
    published: row.published,
    archived: row.archivedAt !== null,
    categoryName: row.categoryName,
    resourceUrls: links.flatMap((link) => (link.url ? [link.url] : [])),
    hasCover: Number(covers[0]?.n ?? 0) > 0,
    revision: String(row.revision),
  };
}

// ── Queueing ────────────────────────────────────────────────────────

export type QueueRefreshResult =
  | {
      ok: true;
      /** The refreshes created, in the order the tools were given. */
      queued: { refreshId: string; toolId: string }[];
      /** Tools that already had an open refresh (§5.1 step 3). */
      skipped: string[];
      /** Ids that name no tool. */
      missing: string[];
    }
  | { ok: false; reason: "daily_limit"; remaining: number };

export interface QueueRefreshInput {
  requestedBy: string;
  requestId: string;
  limit: number;
  since: Date;
  note: string | null;
  includeDescription: boolean;
}

/**
 * Queue a refresh of each tool, inside the day's allowance (§5.1 step 3).
 *
 * One transaction under the same per-person advisory lock intake's
 * `queueForResearchWithinAllowance` takes, counting the same
 * `research_requests` ledger — a refresh and an intake item cost the same, and
 * two presses cannot each see the same count. Tools with an open refresh are
 * skipped, and cost nothing; a refresh abandoned by a run that died a day ago
 * is failed first, so it no longer blocks the tool. Each row records the tool's
 * revision now (`base_revision`): accepting writes only while the tool still
 * carries it.
 */
export async function queueRefreshesWithinAllowance(
  toolIds: readonly string[],
  input: QueueRefreshInput,
  options: RefreshOptions = {}
): Promise<QueueRefreshResult> {
  const candidates = [...new Set(toolIds.filter(isUuid))];
  const missingShape = toolIds.filter((id) => !isUuid(id));
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx): Promise<QueueRefreshResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`research:${input.requestedBy}`}))`);
    if (candidates.length === 0) return { ok: true, queued: [], skipped: [], missing: missingShape };

    await failAbandonedRefreshes({ db: tx, toolIds: candidates });

    const existing = await tx.select({ id: tools.id }).from(tools).where(inArray(tools.id, candidates));
    const found = new Set(existing.map((row) => row.id));
    const missing = [...missingShape, ...candidates.filter((id) => !found.has(id))];

    const open = await tx
      .select({ toolId: toolRefreshes.toolId })
      .from(toolRefreshes)
      .where(and(inArray(toolRefreshes.toolId, candidates), inArray(toolRefreshes.status, [...OPEN_REFRESH_STATUS])));
    const busy = new Set(open.map((row) => row.toolId));
    const skipped = candidates.filter((id) => found.has(id) && busy.has(id));
    const toQueue = candidates.filter((id) => found.has(id) && !busy.has(id));
    if (toQueue.length === 0) return { ok: true, queued: [], skipped, missing };

    const used = await countResearchRequestedSince(input.requestedBy, input.since, { db: tx });
    if (used + toQueue.length > input.limit) {
      return { ok: false, reason: "daily_limit", remaining: Math.max(0, input.limit - used) };
    }

    const inserted = await tx
      .insert(toolRefreshes)
      .select(
        tx
          .select({
            id: sql`gen_random_uuid()`.as("id"),
            toolId: tools.id,
            status: sql`'queued'`.as("status"),
            requestId: sql`${input.requestId}::uuid`.as("request_id"),
            baseRevision: revisionOf(tools.updatedAt).as("base_revision"),
            note: sql`${input.note}::text`.as("note"),
            includeDescription: sql`${input.includeDescription}::boolean`.as("include_description"),
            research: sql`null::jsonb`.as("research"),
            proposals: sql`null::jsonb`.as("proposals"),
            researchError: sql`null::text`.as("research_error"),
            workflowRunId: sql`null::text`.as("workflow_run_id"),
            requestedBy: sql`${input.requestedBy}::text`.as("requested_by"),
            decidedBy: sql`null::text`.as("decided_by"),
            decidedAt: sql`null::timestamptz`.as("decided_at"),
            createdAt: sql`now()`.as("created_at"),
            updatedAt: sql`now()`.as("updated_at"),
          })
          .from(tools)
          .where(inArray(tools.id, toQueue))
      )
      .onConflictDoNothing()
      .returning({ id: toolRefreshes.id, toolId: toolRefreshes.toolId });

    const byTool = new Map(inserted.map((row) => [row.toolId, row.id]));
    const queued = toQueue.flatMap((toolId) => {
      const refreshId = byTool.get(toolId);
      return refreshId ? [{ refreshId, toolId }] : [];
    });
    // A tool another press queued between the check and the insert: skipped, not charged.
    skipped.push(...toQueue.filter((toolId) => !byTool.has(toolId)));

    if (queued.length > 0) {
      await tx.insert(researchRequests).values(
        queued.map((row) => ({ requestId: input.requestId, userId: input.requestedBy, toolRefreshId: row.refreshId }))
      );
    }
    return { ok: true, queued, skipped, missing };
  });
}

/** Record the run's id on the rows it was started for. */
export async function setRefreshWorkflowRun(ids: readonly string[], runId: string, options: RefreshOptions = {}): Promise<void> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return;
  const db = options.db ?? (await getDb());
  await db.update(toolRefreshes).set({ workflowRunId: runId }).where(inArray(toolRefreshes.id, valid));
}

/**
 * `start()` threw: the rows cannot be researched by a run that never began, so
 * they fail with why, and **Refresh again** is offered (an open row would
 * block the tool until the day was out).
 */
export async function failRefreshStart(ids: readonly string[], message: string, options: RefreshOptions = {}): Promise<void> {
  const valid = ids.filter(isUuid);
  if (valid.length === 0) return;
  const db = options.db ?? (await getDb());
  await db
    .update(toolRefreshes)
    .set({ status: "failed", researchError: capError(message) })
    .where(and(inArray(toolRefreshes.id, valid), eq(toolRefreshes.status, "queued")));
}

/**
 * Open refreshes nobody has written for a day — the run died — become
 * `failed`, so they stop blocking their tools. Scoped to `toolIds` when given.
 */
export async function failAbandonedRefreshes(
  options: RefreshOptions & { toolIds?: readonly string[]; now?: Date } = {}
): Promise<number> {
  const db = options.db ?? (await getDb());
  const cutoff = new Date((options.now ?? new Date()).getTime() - REFRESH_ABANDONED_AFTER_MS);
  const rows = await db
    .update(toolRefreshes)
    .set({ status: "failed", researchError: ABANDONED_REFRESH_MESSAGE })
    .where(
      and(
        inArray(toolRefreshes.status, ["queued", "researching"]),
        lt(toolRefreshes.updatedAt, cutoff),
        options.toolIds ? inArray(toolRefreshes.toolId, [...options.toolIds]) : undefined
      )
    )
    .returning({ id: toolRefreshes.id });
  return rows.length;
}

// ── The run's writes ────────────────────────────────────────────────

/**
 * The search step's claim: `queued` → `researching`, for this request only —
 * or the row this request's own earlier attempt already claimed. Null when the
 * row is neither (it was superseded, or its tool deleted).
 */
export async function claimRefresh(id: string, requestId: string, options: RefreshOptions = {}): Promise<ToolRefresh | null> {
  if (!isUuid(id) || !isUuid(requestId)) return null;
  const db = options.db ?? (await getDb());
  const [claimed] = await db
    .update(toolRefreshes)
    .set({ status: "researching", researchError: null })
    .where(and(eq(toolRefreshes.id, id), eq(toolRefreshes.status, "queued"), eq(toolRefreshes.requestId, requestId)))
    .returning();
  if (claimed) return toRefresh(claimed);
  const current = await getRefresh(id, { db });
  return current?.status === "researching" && current.requestId === requestId ? current : null;
}

/** The row, while it is still `researching` under `requestId`. */
export async function refreshStillResearching(id: string, requestId: string, options: RefreshOptions = {}): Promise<ToolRefresh | null> {
  const current = await getRefresh(id, options);
  return current?.status === "researching" && current.requestId === requestId ? current : null;
}

/**
 * `researching` → `proposed`, with the result and the proposals code derived
 * from it. Both are validated on the way in — a step holding output that does
 * not parse has a bug, not a finding, so this **throws**. False when the row
 * is no longer this run's.
 */
export async function completeRefresh(
  id: string,
  requestId: string,
  research: ResearchResult,
  proposals: FieldProposal[],
  options: RefreshOptions = {}
): Promise<boolean> {
  const validResearch = researchResultSchema.parse(research);
  const validProposals = fieldProposalsSchema.parse(proposals);
  if (!isUuid(id) || !isUuid(requestId)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(toolRefreshes)
    .set({ status: "proposed", research: validResearch, proposals: validProposals, researchError: null })
    .where(and(eq(toolRefreshes.id, id), eq(toolRefreshes.status, "researching"), eq(toolRefreshes.requestId, requestId)))
    .returning({ id: toolRefreshes.id });
  return rows.length > 0;
}

/** `queued` or `researching` → `failed`, with why — for this request only. */
export async function failRefresh(id: string, requestId: string, message: string, options: RefreshOptions = {}): Promise<boolean> {
  if (!isUuid(id) || !isUuid(requestId)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(toolRefreshes)
    .set({ status: "failed", researchError: capError(message) })
    .where(
      and(
        eq(toolRefreshes.id, id),
        inArray(toolRefreshes.status, ["queued", "researching"]),
        eq(toolRefreshes.requestId, requestId)
      )
    )
    .returning({ id: toolRefreshes.id });
  return rows.length > 0;
}

// ── Decisions ───────────────────────────────────────────────────────

export interface SaveDecisionsInput {
  proposals: FieldProposal[];
  /** The tool's revision after this decision's writes (or after a conflict, the one to decide against). */
  baseRevision: Revision;
  decidedBy: string | null;
  /** Close the refresh: nothing is left for anybody to decide. */
  close: boolean;
}

/**
 * Record decisions on a `proposed` refresh. Conditional on the list the caller
 * read (`expectedUpdatedAt`, the row's revision): two admins deciding the same
 * refresh at once cannot overwrite each other's cards — the second is told to
 * reload. False when nothing was written.
 */
export async function saveRefreshDecisions(
  id: string,
  expectedRowRevision: Revision,
  input: SaveDecisionsInput,
  options: RefreshOptions = {}
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const proposals = fieldProposalsSchema.parse(input.proposals);
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(toolRefreshes)
    .set({
      proposals,
      baseRevision: input.baseRevision,
      ...(input.close
        ? { status: "decided" as const, decidedBy: input.decidedBy, decidedAt: sql`now()` }
        : {}),
    })
    .where(
      and(
        eq(toolRefreshes.id, id),
        eq(toolRefreshes.status, "proposed"),
        sql`${revisionOf(toolRefreshes.updatedAt)} = ${expectedRowRevision}`
      )
    )
    .returning({ id: toolRefreshes.id });
  return rows.length > 0;
}

/** A refresh's own row revision — the token `saveRefreshDecisions` compares. */
export async function getRefreshRowRevision(id: string, options: RefreshOptions = {}): Promise<Revision | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await rawRows<{ revision: string }>(
    db,
    sql`select extract(epoch from updated_at)::text as revision from tool_refreshes where id = ${id}`
  );
  return row?.revision ?? null;
}

/** Close a `proposed` refresh with nothing to decide (§5.2: "closes as decided when viewed"). */
export async function closeEmptyRefresh(id: string, decidedBy: string | null, options: RefreshOptions = {}): Promise<boolean> {
  if (!isUuid(id)) return false;
  const db = options.db ?? (await getDb());
  const rows = await db
    .update(toolRefreshes)
    .set({ status: "decided", decidedBy, decidedAt: sql`now()` })
    .where(and(eq(toolRefreshes.id, id), eq(toolRefreshes.status, "proposed")))
    .returning({ id: toolRefreshes.id });
  return rows.length > 0;
}

/** Every refresh of a tool, newest first — for tests and diagnosis. */
export async function listRefreshesForTool(toolId: string, options: RefreshOptions = {}): Promise<ToolRefresh[]> {
  if (!isUuid(toolId)) return [];
  const db = options.db ?? (await getDb());
  const rows = await db
    .select()
    .from(toolRefreshes)
    .where(eq(toolRefreshes.toolId, toolId))
    .orderBy(desc(toolRefreshes.createdAt), asc(toolRefreshes.id));
  return rows.map(toRefresh);
}

/** Refresh rows with no tool left are impossible (cascade); kept for the type checker's sake. */
export function isRefreshStatus(value: string): value is RefreshStatus {
  return isOneOf(REFRESH_STATUS, value);
}

// ── Helpers ─────────────────────────────────────────────────────────

function toRefresh(row: typeof toolRefreshes.$inferSelect): ToolRefresh {
  return {
    id: row.id,
    toolId: row.toolId,
    status: isRefreshStatus(row.status) ? row.status : "failed",
    requestId: row.requestId,
    baseRevision: row.baseRevision,
    note: row.note,
    includeDescription: row.includeDescription,
    research: row.research == null ? null : parseResearchResult(row.research),
    proposals: row.proposals == null ? null : parseProposals(row.proposals),
    researchError: row.researchError,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function capError(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
}
