import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import {
  attachments,
  categories,
  locations,
  maintenanceLogs,
  resources,
  tools,
  units,
} from "../db/schema/index.ts";
import { UNIT_STATUS, isOneOf, type UnitStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { openRefreshesByTool } from "./tool-refreshes.ts";

/**
 * The `/admin/inventory` review table (spec §5.3(a)).
 *
 * **This is not the catalogue.** `./catalog.ts` answers "what may a visitor
 * see" — published, unarchived, shaped for display. This module answers "what
 * does the lab own, and which rows are not finished", so it returns drafts and
 * archived tools too, and it carries the *flags* a reviewer sorts by rather
 * than the prose a visitor reads. They stay separate modules because widening
 * the catalogue read with an `includeEverything` flag is how a draft ends up on
 * the public gallery.
 *
 * **Needs attention is the column that earns the page** (§5.3(a)2): a real
 * inventory review is this table filtered to one flag, one row at a time. Every
 * flag is computed in SQL, in six statements whatever the size of the
 * inventory — the tools, then their units, photos, manuals and open tickets in
 * bulk — never one query per tool. `./catalog.ts` sets that discipline; this
 * follows it.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

/** Published, still a draft, or archived. Archived wins over published. */
export type ToolState = "published" | "draft" | "archived";

/** Why a row is in the review queue. Every flag is false for an archived tool. */
export interface InventoryAttention {
  /** No public photo, so the gallery falls back to the bundled image. */
  noPhoto: boolean;
  /** No resource that reads as a manual — see {@link MANUAL_TYPES}. */
  noManual: boolean;
  /** At least one maintenance log still open or in progress. */
  openTickets: boolean;
  /** Nobody has ever pressed "Looks good" on this tool. */
  neverReviewed: boolean;
  /**
   * Refresh research could not identify it, and staff accepted a floor check:
   * somebody has to read the nameplate (refresh research spec §2, §6).
   */
  floorCheck: boolean;
}

/** One row of the review table. */
export interface InventoryRow {
  id: string;
  slug: string;
  /** The display name. */
  name: string;
  /** The official name (tool display names spec), searched beside the name; absent on fixtures from before it. */
  officialName?: string | null;
  /** The cover photo's public URL, or null — null *is* the "no photo" state. */
  photoUrl: string | null;
  categoryName: string | null;
  categoryGroup: string | null;
  room: string | null;
  zone: string | null;
  unitCount: number;
  /** The status of the unit furthest from ready, or null with no units. */
  worstUnitStatus: UnitStatus | null;
  state: ToolState;
  openTicketCount: number;
  lastReviewedAt: Date | null;
  updatedAt: Date;
  attention: InventoryAttention;
  /** True when any flag is set — what the "Needs attention" filter matches. */
  needsAttention: boolean;
  /** The open refresh of this tool, when there is one — the "Refresh open" tag (refresh research spec §6). */
  openRefreshId?: string | null;
}

/** A unit that belongs to no tool (§4.5) — a review item of its own. */
export interface UnlinkedUnit {
  id: string;
  unitLabel: string;
  serialNumber: string | null;
  assetTag: string | null;
  status: string;
}

export interface InventoryQueryOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Unit statuses from furthest-from-ready to settled, which is what the table's
 * one status cell shows for a tool with several units.
 *
 * `retired` ranks *last*, below `available`: it is a decision somebody already
 * made, and a tool with one retired unit and one working one is a working tool.
 * A tool whose units are all retired still reads "Retired", because then there
 * is nothing else to say.
 */
const UNIT_STATUS_SEVERITY: readonly UnitStatus[] = [
  "out_of_service",
  "under_maintenance",
  "in_use",
  "available",
  "retired",
];

/** Tickets that are still somebody's problem (§4.8). */
const OPEN_TICKET_STATUSES = ["open", "in_progress"] as const;

/**
 * Resource types that count as documentation for the "no manual" flag.
 *
 * `type` is free text with no CHECK (§4.6), so this is a list of the values the
 * workspace actually uses rather than a vocabulary. A resource whose type says
 * nothing still counts when it points at a PDF — the flag asks "is there
 * something to read", not "is it labelled correctly".
 */
const MANUAL_TYPES = ["manual", "sop", "guide", "documentation", "instructions"] as const;

/**
 * Every tool, drafts and archived rows included, with its review flags.
 *
 * Ordered by name, like the catalogue: this table is read top to bottom by a
 * person working through it, and a stable order is what lets them stop and come
 * back. Unbounded on purpose — the whole inventory is the point of the page,
 * and it is the same order of magnitude as the gallery.
 */
export async function listInventoryRows(
  options: InventoryQueryOptions = {}
): Promise<InventoryRow[]> {
  const db = options.db ?? (await getDb());

  const toolRows = await db
    .select({
      id: tools.id,
      slug: tools.slug,
      name: tools.name,
      officialName: tools.officialName,
      published: tools.published,
      archivedAt: tools.archivedAt,
      lastReviewedAt: tools.lastReviewedAt,
      updatedAt: tools.updatedAt,
      floorCheck: tools.floorCheck,
      categoryName: categories.name,
      categoryGroup: categories.group,
      room: locations.room,
      zone: locations.zone,
    })
    .from(tools)
    .leftJoin(categories, eq(tools.categoryId, categories.id))
    .leftJoin(locations, eq(tools.locationId, locations.id))
    .orderBy(asc(tools.name));

  if (toolRows.length === 0) return [];
  const toolIds = toolRows.map((tool) => tool.id);

  // Four independent statements, issued together: none of them reads the
  // others' results, and the page waits for the slowest rather than the sum.
  const [unitCounts, photos, manuals, tickets, refreshes] = await Promise.all([
    selectUnitCounts(db, toolIds),
    selectCoverPhotos(db, toolIds),
    selectManualFlags(db, toolIds),
    selectOpenTicketCounts(db, toolIds),
    openRefreshesByTool({ db }),
  ]);

  return toolRows.map((tool) => {
    const state: ToolState = tool.archivedAt
      ? "archived"
      : tool.published
        ? "published"
        : "draft";
    const unitSummary = unitCounts.get(tool.id);
    const openTicketCount = tickets.get(tool.id) ?? 0;
    const photoUrl = photos.get(tool.id) ?? null;

    // An archived tool has been dealt with — archiving is one of the three
    // outcomes of a review (§5.3(a)3). Leaving its flags set would put settled
    // equipment back in the queue every time somebody filters by one.
    const attention: InventoryAttention =
      state === "archived"
        ? { noPhoto: false, noManual: false, openTickets: false, neverReviewed: false, floorCheck: false }
        : {
            noPhoto: photoUrl === null,
            noManual: manuals.get(tool.id) !== true,
            openTickets: openTicketCount > 0,
            neverReviewed: tool.lastReviewedAt === null,
            floorCheck: Boolean(tool.floorCheck?.trim()),
          };

    return {
      id: tool.id,
      slug: tool.slug,
      name: tool.name,
      officialName: tool.officialName,
      photoUrl,
      categoryName: tool.categoryName,
      categoryGroup: tool.categoryGroup,
      room: tool.room,
      zone: tool.zone,
      unitCount: unitSummary?.total ?? 0,
      worstUnitStatus: unitSummary?.worst ?? null,
      state,
      openTicketCount,
      lastReviewedAt: tool.lastReviewedAt,
      updatedAt: tool.updatedAt,
      attention,
      needsAttention: Object.values(attention).some(Boolean),
      openRefreshId: refreshes.get(tool.id) ?? null,
    };
  });
}

/**
 * Units belonging to no tool (§4.5).
 *
 * Returned as their own list rather than attached to a guessed tool: the live
 * workspace has one, and inventing an owner for it is exactly the kind of
 * plausible fiction Article 4 forbids. The page shows it beside the table so
 * somebody can link it.
 */
export async function listUnlinkedUnits(
  options: InventoryQueryOptions = {}
): Promise<UnlinkedUnit[]> {
  const db = options.db ?? (await getDb());

  return db
    .select({
      id: units.id,
      unitLabel: units.unitLabel,
      serialNumber: units.serialNumber,
      assetTag: units.assetTag,
      status: units.status,
    })
    .from(units)
    .where(isNull(units.toolId))
    .orderBy(asc(units.unitLabel), asc(units.id));
}

// ── The four bulk statements ────────────────────────────────────────

/**
 * How many units each tool has, and the status of the worst one.
 *
 * Grouped by `(tool_id, status)` so the result is at most five rows per tool
 * however many machines there are, and the severity order stays in TypeScript
 * where {@link UNIT_STATUS_SEVERITY} can be read and argued with.
 */
async function selectUnitCounts(
  db: Db,
  toolIds: string[]
): Promise<Map<string, { total: number; worst: UnitStatus | null }>> {
  const rows = await db
    .select({ toolId: units.toolId, status: units.status, total: count() })
    .from(units)
    .where(inArray(units.toolId, toolIds))
    .groupBy(units.toolId, units.status);

  const byTool = new Map<string, { total: number; worst: UnitStatus | null }>();
  for (const row of rows) {
    if (!row.toolId) continue;
    const entry = byTool.get(row.toolId) ?? { total: 0, worst: null };
    entry.total += row.total;
    entry.worst = worseOf(entry.worst, row.status);
    byTool.set(row.toolId, entry);
  }
  return byTool;
}

/** The furthest-from-ready of two statuses; an unknown value never wins. */
export function worseOf(current: UnitStatus | null, candidate: string): UnitStatus | null {
  if (!isOneOf(UNIT_STATUS, candidate)) return current;
  if (current === null) return candidate;
  return UNIT_STATUS_SEVERITY.indexOf(candidate) < UNIT_STATUS_SEVERITY.indexOf(current)
    ? candidate
    : current;
}

/**
 * Each tool's cover photo — the lowest-position public attachment it owns
 * (§4.7: position 0 is the cover).
 *
 * `distinct on` so one row comes back per tool rather than every photo in the
 * lab. A private file is not a cover: the table shows what the gallery would
 * show, and the gallery cannot show a file with no public URL.
 */
async function selectCoverPhotos(db: Db, toolIds: string[]): Promise<Map<string, string>> {
  const rows = await db
    .selectDistinctOn([attachments.ownerId], {
      ownerId: attachments.ownerId,
      publicUrl: attachments.publicUrl,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.ownerType, "tool"),
        inArray(attachments.ownerId, toolIds),
        eq(attachments.access, "public"),
        isNotNull(attachments.publicUrl)
      )
    )
    .orderBy(asc(attachments.ownerId), asc(attachments.position), asc(attachments.id));

  const byTool = new Map<string, string>();
  for (const row of rows) {
    if (row.ownerId && row.publicUrl) byTool.set(row.ownerId, row.publicUrl);
  }
  return byTool;
}

/**
 * Which tools have something a person could read before using the machine.
 *
 * A resource counts when its type names documentation, when its link is a PDF,
 * or when it owns a PDF file — deliberately not filtered by
 * `resources.published`, for the reason `./catalog.ts` gives: resources are
 * created as drafts beside their tool and tool-level publishing already gates
 * the catalogue.
 */
async function selectManualFlags(db: Db, toolIds: string[]): Promise<Map<string, boolean>> {
  const looksLikeAManual = or(
    inArray(sql<string>`lower(coalesce(${resources.type}, ''))`, [...MANUAL_TYPES]),
    ilike(resources.url, "%.pdf"),
    eq(attachments.contentType, "application/pdf"),
    ilike(attachments.originalFilename, "%.pdf")
  );

  const rows = await db
    .select({
      toolId: resources.toolId,
      // `coalesce` inside the aggregate: a null comparison (an absent type, a
      // resource with no file) is "no", not "unknown".
      hasManual: sql<boolean>`bool_or(coalesce(${looksLikeAManual}, false))`,
    })
    .from(resources)
    .leftJoin(
      attachments,
      and(eq(attachments.ownerType, "resource"), eq(attachments.ownerId, resources.id))
    )
    .where(inArray(resources.toolId, toolIds))
    .groupBy(resources.toolId);

  const byTool = new Map<string, boolean>();
  for (const row of rows) {
    if (row.toolId) byTool.set(row.toolId, row.hasManual === true);
  }
  return byTool;
}

/** Open and in-progress tickets per tool (§4.8) — resolved ones are history. */
async function selectOpenTicketCounts(db: Db, toolIds: string[]): Promise<Map<string, number>> {
  const rows = await db
    .select({ toolId: maintenanceLogs.toolId, total: count() })
    .from(maintenanceLogs)
    .where(
      and(
        inArray(maintenanceLogs.toolId, toolIds),
        inArray(maintenanceLogs.status, [...OPEN_TICKET_STATUSES])
      )
    )
    .groupBy(maintenanceLogs.toolId);

  const byTool = new Map<string, number>();
  for (const row of rows) {
    if (row.toolId) byTool.set(row.toolId, row.total);
  }
  return byTool;
}
