import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { rawRows } from "../db/raw.ts";
import type { PendingStatus } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import type { DuplicateOf } from "../intake/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * The duplicate check (spec §5.4 step 4): is the thing somebody is adding
 * already here — in the catalogue, as a draft, or in somebody else's pending
 * batch?
 *
 * Two passes in one statement, best match first:
 *
 * 1. **Normalized equality**, brand-aware. "X1-Carbon" from Bambu Lab and
 *    "Bambu Lab X1-Carbon" are the same machine; so are "Form 4" and "form-4".
 * 2. **`pg_trgm` similarity** at or above {@link DUPLICATE_SIMILARITY_THRESHOLD},
 *    for the near misses equality cannot see ("Prusa MK4S" against "Prusa MK4S
 *    3D Printer").
 *
 * What it searches: tools that are **not archived** (published or draft — a
 * draft is still the lab's), and pending items that are **still in play** —
 * not approved (those are tools now, and matched as tools) and not discarded.
 * On a tie a tool wins over a pending item, because a tool is the stronger
 * claim.
 *
 * A match is a question for the person, never a refusal: the intake table asks
 * whether it is another unit, a different tool, or a mistake. So the threshold
 * leans toward asking — a false positive costs one click, a false negative is
 * a second catalogue entry for the same machine.
 *
 * Normalization is ASCII letters and digits, lower-cased, runs of anything
 * else collapsed to one space — the same rule in {@link normalizeToolName} and
 * in the SQL below, so the two cannot disagree about equality.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.5;

export interface DuplicateSearchOptions {
  /** A handle to use instead of {@link getDb} — a caller's transaction, or a test's database. */
  db?: Db;
  /** Pending items that are not candidates — the item being edited, for one. */
  excludePendingIds?: string[];
  /** A batch whose items are not candidates — the one being created. */
  excludeBatchId?: string;
  /** Tools that are not candidates — the tool being refreshed (refresh research spec §2 non-goals). */
  excludeToolIds?: string[];
}

export interface DuplicateQuery {
  name: string;
  brand?: string | null;
}

/** Lower-case, letters and digits only, one space between words. */
function normalizePart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * `"X1-Carbon"`, brand `"Bambu Lab"` → `"bambu lab x1 carbon"`.
 *
 * The brand is prefixed unless the name already starts with it, so a name the
 * model wrote in full and one it split into brand and model normalize alike.
 */
export function normalizeToolName(name: string, brand?: string | null): string {
  const bare = normalizePart(name);
  const normalizedBrand = normalizePart(brand ?? "");
  if (!normalizedBrand) return bare;
  if (bare === normalizedBrand || bare.startsWith(`${normalizedBrand} `)) return bare;
  return bare ? `${normalizedBrand} ${bare}` : normalizedBrand;
}

/** The best match for one name, or null. */
export async function findDuplicate(
  query: DuplicateQuery,
  options: DuplicateSearchOptions = {}
): Promise<DuplicateOf | null> {
  const [match] = await findDuplicates([query], options);
  return match ?? null;
}

/**
 * The best match for each name, in the order given. One statement per name —
 * a batch is at most 25 items (§5.4), and each statement is two index-backed
 * scans of small tables.
 */
export async function findDuplicates(
  queries: DuplicateQuery[],
  options: DuplicateSearchOptions = {}
): Promise<(DuplicateOf | null)[]> {
  if (queries.length === 0) return [];
  const db = options.db ?? (await getDb());

  const results: (DuplicateOf | null)[] = [];
  for (const query of queries) {
    results.push(await bestMatch(db, query, options));
  }
  return results;
}

interface MatchRow {
  kind: "tool" | "pending";
  id: string;
  name: string;
  slug: string | null;
  published: boolean | null;
  status: string | null;
}

/**
 * The SQL twin of {@link normalizePart}. `[^a-z0-9]+` after `lower()` is the
 * same character class the TypeScript uses, so equality means the same thing
 * on both sides.
 */
function sqlNormalized(column: SQL): SQL {
  return sql`btrim(regexp_replace(lower(coalesce(${column}, '')), '[^a-z0-9]+', ' ', 'g'))`;
}

async function bestMatch(
  db: Db,
  query: DuplicateQuery,
  options: DuplicateSearchOptions
): Promise<DuplicateOf | null> {
  const bare = normalizeToolName(query.name);
  const full = normalizeToolName(query.name, query.brand);
  const branded = normalizePart(query.brand ?? "") !== "";
  // Nothing left to compare — a name of only punctuation or non-Latin script.
  // Similarity still gets a chance on the lower-cased original.
  const similarityText = full || query.name.trim().toLowerCase();
  if (!similarityText) return null;

  const excludeIds = (options.excludePendingIds ?? []).filter(isUuid);
  const excludeBatch =
    options.excludeBatchId && isUuid(options.excludeBatchId) ? options.excludeBatchId : null;

  const toolName = sqlNormalized(sql`t.name`);
  const pendingBare = sqlNormalized(sql`p.name`);
  const pendingBrand = sqlNormalized(sql`p.brand`);
  // `normalizeToolName(p.name, p.brand)`, in SQL.
  const pendingFull = sql`(case
      when ${pendingBrand} = '' or ${pendingBare} = ${pendingBrand}
        or ${pendingBare} like ${pendingBrand} || ' %' then ${pendingBare}
      when ${pendingBare} = '' then ${pendingBrand}
      else ${pendingBrand} || ' ' || ${pendingBare}
    end)`;

  // A tool has no brand column, so its name may or may not carry the brand:
  // it matches either spelling of the query.
  // Either of its two names (tool display names spec §5.6): the official name
  // is the one an identified item usually spells out.
  const toolOfficial = sqlNormalized(sql`t.official_name`);
  const toolExact = full ? sql`(${toolName} in (${full}, ${bare}) or ${toolOfficial} in (${full}, ${bare}))` : sql`false`;

  // Both sides branded: compare the full forms. Either side unbranded: its bare
  // name may be either form of the other side.
  const pendingExact = !full
    ? sql`false`
    : branded
      ? sql`((${pendingBrand} <> '' and ${pendingFull} = ${full})
            or (${pendingBrand} = '' and ${pendingBare} in (${full}, ${bare})))`
      : sql`${bare} in (${pendingFull}, ${pendingBare})`;

  const pendingFilters: SQL[] = [sql`p.status not in ('approved', 'discarded')`];
  if (excludeBatch) pendingFilters.push(sql`p.batch_id <> ${excludeBatch}::uuid`);
  if (excludeIds.length > 0) {
    pendingFilters.push(
      sql`p.id not in (${sql.join(
        excludeIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    );
  }

  const excludeTools = (options.excludeToolIds ?? []).filter(isUuid);
  const toolFilter =
    excludeTools.length > 0
      ? sql` and t.id not in (${sql.join(
          excludeTools.map((id) => sql`${id}::uuid`),
          sql`, `
        )})`
      : sql``;

  const rows = await rawRows<MatchRow & { exact: boolean; score: number }>(
    db,
    sql`
      select * from (
        select 'tool' as kind, t.id::text as id, t.name, t.slug, t.published,
               null::text as status,
               ${toolExact} as exact,
               greatest(similarity(lower(t.name), ${similarityText}),
                        similarity(lower(t.name), ${bare || similarityText}),
                        coalesce(similarity(lower(t.official_name), ${similarityText}), 0),
                        coalesce(similarity(lower(t.official_name), ${bare || similarityText}), 0))::float8 as score,
               0 as rank
          from tools t
         where t.archived_at is null${toolFilter}
        union all
        select 'pending' as kind, p.id::text as id, p.name, null::text as slug,
               null::boolean as published, p.status,
               ${pendingExact} as exact,
               similarity(lower(concat_ws(' ', p.brand, p.name)), ${similarityText})::float8 as score,
               1 as rank
          from pending_tools p
         where ${sql.join(pendingFilters, sql` and `)}
      ) candidates
      where exact or score >= ${DUPLICATE_SIMILARITY_THRESHOLD}
      order by exact desc, score desc, rank asc, name asc
      limit 1
    `
  );

  const row = rows[0];
  if (!row) return null;
  if (row.kind === "tool") {
    return {
      kind: "tool",
      id: row.id,
      name: row.name,
      slug: row.slug ?? "",
      published: Boolean(row.published),
    };
  }
  return { kind: "pending", id: row.id, name: row.name, status: row.status as PendingStatus };
}
