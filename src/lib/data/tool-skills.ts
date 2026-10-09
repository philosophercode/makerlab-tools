import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { tools, toolSkills } from "../db/schema/index.ts";
import type { ToolSkillStatus, ToolSkillTrigger } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * `tool_skills` (tool skills spec 2026-10-07, migration `0031`): the reads and
 * the one write. A tool's **current skill** is its latest `ready` row; its
 * **latest attempt** is its latest row of either status. Relative imports with
 * `.ts` extensions and no `"server-only"`, like every module under
 * `src/lib/data/`: the workflow step and `npm run tools:skills` load it.
 */

export interface ToolSkillRow {
  id: string;
  toolId: string;
  version: number;
  status: ToolSkillStatus;
  content: string;
  /** As stored; read with `skillSectionsSchema` (`lib/skills/format.ts`). */
  sections: unknown;
  /** As stored; read with `skillSourcesSchema`. */
  sources: unknown;
  inputHash: string;
  model: string;
  costUsd: number;
  trigger: ToolSkillTrigger;
  error: string | null;
  createdAt: Date;
}

const COLUMNS = {
  id: toolSkills.id,
  toolId: toolSkills.toolId,
  version: toolSkills.version,
  status: toolSkills.status,
  content: toolSkills.content,
  sections: toolSkills.sections,
  sources: toolSkills.sources,
  inputHash: toolSkills.inputHash,
  model: toolSkills.model,
  costUsd: toolSkills.costUsd,
  trigger: toolSkills.trigger,
  error: toolSkills.error,
  createdAt: toolSkills.createdAt,
};

function toRow(row: Record<keyof typeof COLUMNS, unknown>): ToolSkillRow {
  return {
    ...(row as unknown as ToolSkillRow),
    costUsd: Number(row.costUsd ?? 0),
    createdAt: new Date(row.createdAt as string | Date),
  };
}

/** The tool's current skill — its latest `ready` row — or null. */
export async function currentToolSkill(db: Db, toolId: string): Promise<ToolSkillRow | null> {
  if (!isUuid(toolId)) return null;
  const [row] = await db
    .select(COLUMNS)
    .from(toolSkills)
    .where(and(eq(toolSkills.toolId, toolId), eq(toolSkills.status, "ready")))
    .orderBy(desc(toolSkills.version))
    .limit(1);
  return row ? toRow(row) : null;
}

/** The tool's latest attempt, `ready` or `failed`, or null. */
export async function latestToolSkill(db: Db, toolId: string): Promise<ToolSkillRow | null> {
  if (!isUuid(toolId)) return null;
  const [row] = await db
    .select(COLUMNS)
    .from(toolSkills)
    .where(eq(toolSkills.toolId, toolId))
    .orderBy(desc(toolSkills.version))
    .limit(1);
  return row ? toRow(row) : null;
}

/** The current version of each of these tools that has one (for lists). */
export async function currentSkillVersions(db: Db, toolIds: readonly string[]): Promise<Map<string, number>> {
  const ids = toolIds.filter(isUuid);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ toolId: toolSkills.toolId, version: sql<number>`max(${toolSkills.version})` })
    .from(toolSkills)
    .where(and(eq(toolSkills.status, "ready"), sql`${toolSkills.toolId} in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`))
    .groupBy(toolSkills.toolId);
  return new Map(rows.map((row) => [row.toolId, Number(row.version)]));
}

export interface NewToolSkill {
  toolId: string;
  status: ToolSkillStatus;
  content?: string;
  sections?: unknown;
  sources?: unknown;
  inputHash: string;
  model: string;
  costUsd?: number;
  trigger: ToolSkillTrigger;
  error?: string | null;
  /**
   * The markdown for the version this row takes, when it names its version:
   * called inside the transaction with the number the lock handed out.
   * Overrides `content`.
   */
  contentFor?: (version: number) => string;
}

/**
 * Store one attempt as the tool's next version, in one transaction under an
 * advisory lock on the tool, so two runs finishing at once cannot both take
 * the same number (the unique constraint is the backstop).
 */
export async function insertToolSkill(db: Db, input: NewToolSkill): Promise<{ id: string; version: number }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tool_skills:${input.toolId}`}))`);
    const [last] = await tx
      .select({ version: sql<number | null>`max(${toolSkills.version})` })
      .from(toolSkills)
      .where(eq(toolSkills.toolId, input.toolId));
    const version = Number(last?.version ?? 0) + 1;
    const [row] = await tx
      .insert(toolSkills)
      .values({
        toolId: input.toolId,
        version,
        status: input.status,
        content: input.contentFor ? input.contentFor(version) : (input.content ?? ""),
        sections: input.sections ?? {},
        sources: input.sources ?? [],
        inputHash: input.inputHash,
        model: input.model,
        costUsd: input.costUsd ?? 0,
        trigger: input.trigger,
        error: input.error ?? null,
      })
      .returning({ id: toolSkills.id, version: toolSkills.version });
    return row;
  });
}

/** Rows written since `since`, any tool, any status, any trigger: what the daily cap counts. */
export async function countToolSkillsSince(db: Db, since: Date): Promise<number> {
  const [row] = await db.select({ n: count() }).from(toolSkills).where(gte(toolSkills.createdAt, since));
  return Number(row?.n ?? 0);
}

export interface SkillTarget {
  id: string;
  slug: string;
  name: string;
  published: boolean;
}

/** Tools a skill may be written for — every tool not archived, by name; one by slug with `toolSlug`. */
export async function listToolsForSkills(db: Db, options: { toolSlug?: string | null; limit?: number | null } = {}): Promise<SkillTarget[]> {
  const rows = await db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, published: tools.published })
    .from(tools)
    .where(and(isNull(tools.archivedAt), options.toolSlug ? eq(tools.slug, options.toolSlug) : undefined))
    .orderBy(asc(tools.name), asc(tools.id))
    .limit(options.limit && options.limit > 0 ? options.limit : 100_000);
  return rows;
}
