import { and, asc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { manualDocuments } from "../db/schema/manuals.ts";
import { resources } from "../db/schema/resources.ts";
import { starterAnswers } from "../db/schema/starter-answers.ts";
import { tools } from "../db/schema/tools.ts";
import type { Db } from "../db/types.ts";
import type { GeneralHashInputs, ManualHashInput, ToolHashInputs } from "../starters/hash.ts";
import { revisionOf } from "./revision.ts";
import { isUuid } from "./uuid.ts";

/**
 * `starter_answers` (migration `0026`): the pre-run answers to the starter
 * chips, and the reads that say whether one still holds (`lib/starters/hash.ts`
 * is the rule). Relative imports with `.ts` extensions, no `"server-only"`,
 * like every module under `src/lib/data/`.
 */

/** What a grade stored with an answer looks like (`lib/starters/grade.ts` writes it). */
export interface StoredGrade {
  score: number;
  reasons: string[];
  [key: string]: unknown;
}

export interface StarterAnswerRow {
  id: string;
  toolId: string | null;
  locale: string;
  question: string;
  message: unknown;
  model: string;
  accepted: boolean;
  grade: StoredGrade;
  usageEvents: unknown;
  sourceHash: string;
  updatedAt: Date;
}

const ROW = {
  id: starterAnswers.id,
  toolId: starterAnswers.toolId,
  locale: starterAnswers.locale,
  question: starterAnswers.question,
  message: starterAnswers.message,
  model: starterAnswers.model,
  accepted: starterAnswers.accepted,
  grade: starterAnswers.grade,
  usageEvents: starterAnswers.usageEvents,
  sourceHash: starterAnswers.sourceHash,
  updatedAt: starterAnswers.updatedAt,
};

function scopeIs(toolId: string | null): SQL {
  return toolId === null ? isNull(starterAnswers.toolId) : eq(starterAnswers.toolId, toolId);
}

/** Every stored answer for one chip set: a tool's (`toolId`), or the general chips' (`null`). */
export async function listStarterAnswers(db: Db, scope: { toolId: string | null; locale: string }): Promise<StarterAnswerRow[]> {
  const rows = await db
    .select(ROW)
    .from(starterAnswers)
    .where(and(scopeIs(scope.toolId), eq(starterAnswers.locale, scope.locale)))
    .orderBy(asc(starterAnswers.question));
  return rows as StarterAnswerRow[];
}

/** Every stored answer, message left out — the admin view's read. */
export async function listStarterAnswerSummaries(db: Db): Promise<Omit<StarterAnswerRow, "message" | "usageEvents">[]> {
  const summary = {
    id: ROW.id,
    toolId: ROW.toolId,
    locale: ROW.locale,
    question: ROW.question,
    model: ROW.model,
    accepted: ROW.accepted,
    grade: ROW.grade,
    sourceHash: ROW.sourceHash,
    updatedAt: ROW.updatedAt,
  };
  const rows = await db.select(summary).from(starterAnswers).orderBy(asc(starterAnswers.question));
  return rows as Omit<StarterAnswerRow, "message" | "usageEvents">[];
}

export interface StarterAnswerWrite {
  toolId: string | null;
  locale: string;
  question: string;
  message: unknown;
  model: string;
  accepted: boolean;
  grade: StoredGrade;
  usageEvents: unknown;
  sourceHash: string;
}

/** Insert or replace the answer for one chip (tool, locale, question). */
export async function upsertStarterAnswer(db: Db, row: StarterAnswerWrite): Promise<void> {
  await db
    .insert(starterAnswers)
    .values(row)
    .onConflictDoUpdate({
      target: [starterAnswers.toolId, starterAnswers.locale, starterAnswers.question],
      set: {
        message: row.message,
        model: row.model,
        accepted: row.accepted,
        grade: row.grade,
        usageEvents: row.usageEvents,
        sourceHash: row.sourceHash,
        updatedAt: sql`now()`,
      },
    });
}

/** Drop a chip set's answers to questions it no longer shows. Answers how many went. */
export async function deleteStarterAnswersExcept(
  db: Db,
  scope: { toolId: string | null; locale: string },
  keep: readonly string[]
): Promise<number> {
  const conditions: SQL[] = [scopeIs(scope.toolId), eq(starterAnswers.locale, scope.locale)];
  if (keep.length > 0) conditions.push(notInArray(starterAnswers.question, [...keep]));
  const gone = await db.delete(starterAnswers).where(and(...conditions)).returning({ id: starterAnswers.id });
  return gone.length;
}

// ── What an answer depended on (`lib/starters/hash.ts`) ─────────────

const MANUAL = {
  id: manualDocuments.id,
  toolId: manualDocuments.toolId,
  status: manualDocuments.status,
  extractorVersion: manualDocuments.extractorVersion,
  chunkerVersion: manualDocuments.chunkerVersion,
  embeddingModel: manualDocuments.embeddingModel,
  ocrVersion: manualDocuments.ocrVersion,
  updatedAt: revisionOf(manualDocuments.updatedAt),
};

function manualInput(row: { id: string; status: string; extractorVersion: string; chunkerVersion: string | null; embeddingModel: string | null; ocrVersion: string | null; updatedAt: string }): ManualHashInput {
  return {
    id: row.id,
    status: row.status,
    extractorVersion: row.extractorVersion,
    chunkerVersion: row.chunkerVersion,
    embeddingModel: row.embeddingModel,
    ocrVersion: row.ocrVersion,
    updatedAt: row.updatedAt,
  };
}

/**
 * The hash inputs of each tool in `toolIds` that exists: three reads,
 * whatever the number of tools. A missing id is absent from the map.
 */
export async function loadToolHashInputs(db: Db, toolIds: readonly string[]): Promise<Map<string, ToolHashInputs>> {
  const ids = [...new Set(toolIds.filter(isUuid))];
  const out = new Map<string, ToolHashInputs>();
  if (ids.length === 0) return out;
  const [toolRows, resourceRows, manualRows] = await Promise.all([
    db.select({ id: tools.id, revision: revisionOf(tools.updatedAt) }).from(tools).where(inArray(tools.id, ids)),
    db
      .select({ id: resources.id, toolId: resources.toolId, updatedAt: revisionOf(resources.updatedAt), published: resources.published })
      .from(resources)
      .where(inArray(resources.toolId, ids)),
    db.select(MANUAL).from(manualDocuments).where(inArray(manualDocuments.toolId, ids)),
  ]);
  for (const tool of toolRows) {
    out.set(tool.id, {
      kind: "tool",
      toolId: tool.id,
      revision: tool.revision,
      resources: resourceRows
        .filter((r) => r.toolId === tool.id)
        .map((r) => ({ id: r.id, updatedAt: r.updatedAt, published: r.published })),
      manuals: manualRows.filter((m) => m.toolId === tool.id).map(manualInput),
    });
  }
  return out;
}

/** The general chips' hash inputs: the published catalogue's names and every manual's state. */
export async function loadGeneralHashInputs(db: Db): Promise<GeneralHashInputs> {
  const [toolRows, manualRows] = await Promise.all([
    db
      .select({ id: tools.id, name: tools.name })
      .from(tools)
      .where(and(eq(tools.published, true), isNull(tools.archivedAt))),
    db.select(MANUAL).from(manualDocuments),
  ]);
  return { kind: "general", tools: toolRows, manuals: manualRows.map(manualInput) };
}

// ── The tool a chip set belongs to ──────────────────────────────────

export interface StarterTool {
  id: string;
  slug: string;
  name: string;
  starterQuestions: string[];
}

/**
 * A published, unarchived tool by id or slug (the chat's path segment), with
 * its current starter questions; null for anything else — a draft's chips are
 * never served from the cache (its answers are made as an anonymous visitor,
 * who cannot see a draft).
 */
export async function findPublishedStarterTool(db: Db, idOrSlug: string): Promise<StarterTool | null> {
  const match = isUuid(idOrSlug) ? eq(tools.id, idOrSlug) : eq(tools.slug, idOrSlug);
  const [row] = await db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, starterQuestions: tools.starterQuestions })
    .from(tools)
    .where(and(match, eq(tools.published, true), isNull(tools.archivedAt)))
    .limit(1);
  return row ?? null;
}

/** Every published, unarchived tool with at least one starter question, by name. */
export async function listPublishedStarterTools(db: Db): Promise<StarterTool[]> {
  return db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, starterQuestions: tools.starterQuestions })
    .from(tools)
    .where(and(eq(tools.published, true), isNull(tools.archivedAt), sql`cardinality(${tools.starterQuestions}) > 0`))
    .orderBy(asc(tools.name));
}
