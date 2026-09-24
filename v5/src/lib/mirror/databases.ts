import { getDb } from "../db/client.ts";
import { MIRROR_ENTITY, type MirrorEntity } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { getMirror, getMirrorTokenCiphertext, resetMirrorEntities, setMirrorMapping } from "../data/mirrors.ts";
import { mirrorClientFor } from "./credentials.ts";
import {
  databaseCreateBody,
  expectedProperties,
  normalizeDatabaseId,
  propertySchemaBody,
  validateDatabaseSchema,
} from "./database-schemas.ts";
import { NotionMirrorError, type NotionClient, type NotionClientOptions, type NotionDatabaseObject } from "./notion-client.ts";
import { parseNotionId } from "./notion-id.ts";
import type { MappingProblem, MirrorMapping, MirrorSetupError } from "./types.ts";

/**
 * Setting up a mirror's databases (spec §3.8 "Mapping", §5.8).
 *
 * - {@link ensureMirrorDatabases} is **Create databases**: it keeps every mapped
 *   database that still exists and creates the rest under the connected page,
 *   in dependency order, so each relation can point at a database that is
 *   already there. Run it again after somebody deletes a database by hand and
 *   it recreates only that one (§5.8).
 * - {@link applyPastedMapping} is the other road: an admin who already has
 *   databases pastes their ids, and each is checked against the fixed schema
 *   before anything is saved.
 *
 * Both return refusals as values (`MirrorSetupError` codes the page
 * translates), never a Notion message: those can carry text from the
 * workspace, and nothing from Notion reaches the page except its title.
 *
 * Relative imports with `.ts` extensions, no `server-only`: reachable from
 * step code.
 */

export interface MirrorDatabaseOptions {
  db?: Db;
  client?: Partial<Omit<NotionClientOptions, "token">>;
}

export type EnsureDatabasesResult =
  | { ok: true; created: MirrorEntity[]; kept: MirrorEntity[]; mapping: MirrorMapping }
  | { ok: false; code: MirrorSetupError; created: MirrorEntity[]; entity: MirrorEntity | null };

export type ApplyMappingResult =
  | { ok: true; mapping: MirrorMapping }
  | { ok: false; code: MirrorSetupError; problems: MappingProblem[] };

type ClientResult = { ok: true; client: NotionClient; parentPageId: string; mapping: MirrorMapping } | { ok: false; code: MirrorSetupError };

async function openMirror(mirrorId: string, options: MirrorDatabaseOptions, db: Db): Promise<ClientResult> {
  const mirror = await getMirror(mirrorId, { db });
  if (!mirror) return { ok: false, code: "not_connected" };
  const ciphertext = await getMirrorTokenCiphertext(mirrorId, { db });
  const opened = mirrorClientFor(ciphertext, options.client ?? {});
  if (!opened.ok) return { ok: false, code: opened.code };
  return { ok: true, client: opened.client, parentPageId: mirror.parentPageId, mapping: mirror.mapping };
}

/** A Notion failure during setup, as the code the page shows. */
export function setupErrorFor(error: unknown, notFound: MirrorSetupError): MirrorSetupError {
  if (!(error instanceof NotionMirrorError)) return "notion_unavailable";
  switch (error.code) {
    case "unauthorized":
    case "restricted":
      return "unauthorized";
    case "page_not_found":
    case "database_not_found":
    case "not_found":
      return notFound;
    default:
      return "notion_unavailable";
  }
}

function isGone(database: NotionDatabaseObject): boolean {
  return database.archived === true || database.in_trash === true;
}

/**
 * `PATCH` body for a kept database whose relations do not point at the
 * databases `resolved` now holds — the dependents of a recreated database.
 * Null when every relation is already right.
 */
function relationRepair(entity: MirrorEntity, database: NotionDatabaseObject, resolved: MirrorMapping): Record<string, unknown> | null {
  const properties: Record<string, unknown> = {};
  for (const expected of expectedProperties(entity, resolved)) {
    if (expected.type !== "relation" || !expected.targetDatabaseId) continue;
    const actual = database.properties?.[expected.name];
    if (actual && actual.type !== "relation") continue; // a clash of types is for the admin to see, not for us to overwrite
    if (actual && normalizeDatabaseId(actual.relation?.database_id) === expected.targetDatabaseId) continue;
    const body = propertySchemaBody(expected, expected.targetDatabaseId);
    if (body) properties[expected.name] = body;
  }
  return Object.keys(properties).length ? { properties } : null;
}

/**
 * Keep what exists, create what does not, fix the relations of what was kept,
 * and save the mapping — including a partial one when Notion fails half way,
 * so a second press picks up from there instead of creating duplicates.
 *
 * A database is kept when a `GET` answers 200 and it is neither archived nor
 * in the trash; a 404, archived or trashed database is created again. Every
 * entity created loses its `mirror_pages` rows and makes the next push a full
 * one (`resetMirrorEntities`): its old page ids point into a database that is
 * gone, and a newly mapped entity has rows older than `last_synced_at`. The
 * reset also marks the pages that link to it (units, resources, maintenance
 * and projects for tools, and so on) as not mirrored, so the push rewrites
 * their relations to the new pages.
 */
export async function ensureMirrorDatabases(
  mirrorId: string,
  options: MirrorDatabaseOptions = {}
): Promise<EnsureDatabasesResult> {
  const db = options.db ?? (await getDb());
  const opened = await openMirror(mirrorId, options, db);
  if (!opened.ok) return { ok: false, code: opened.code, created: [], entity: null };
  const { client, parentPageId } = opened;

  const resolved: MirrorMapping = {};
  const created: MirrorEntity[] = [];
  const kept: MirrorEntity[] = [];
  let failure: { code: MirrorSetupError; entity: MirrorEntity } | null = null;

  for (const entity of MIRROR_ENTITY) {
    const mappedId = opened.mapping[entity];
    try {
      let existing: NotionDatabaseObject | null = null;
      if (mappedId) {
        try {
          existing = await client.getDatabase(mappedId);
          if (isGone(existing)) existing = null;
        } catch (error) {
          if (!(error instanceof NotionMirrorError) || error.code !== "database_not_found") throw error;
        }
      }

      if (existing) {
        const id = normalizeDatabaseId(existing.id) ?? mappedId!;
        const repair = relationRepair(entity, existing, resolved);
        if (repair) await client.updateDatabase(id, repair);
        resolved[entity] = id;
        kept.push(entity);
        continue;
      }

      let fresh: NotionDatabaseObject;
      try {
        fresh = await client.createDatabase(databaseCreateBody(entity, parentPageId, resolved));
      } catch (error) {
        // A 404 on create is the parent page: unshared, or deleted.
        failure = { code: setupErrorFor(error, "page_not_found"), entity };
        break;
      }
      resolved[entity] = normalizeDatabaseId(fresh.id) ?? fresh.id;
      created.push(entity);
    } catch (error) {
      failure = { code: setupErrorFor(error, "database_not_found"), entity };
      break;
    }
  }

  // Save what is true now, even half way: databases that were created exist
  // in Notion, and forgetting them would duplicate them on the next press.
  const mapping: MirrorMapping = failure ? { ...opened.mapping, ...resolved } : resolved;
  if (created.length) await resetMirrorEntities(mirrorId, created, { db });
  const saved = await setMirrorMapping(mirrorId, mapping, { db });

  if (failure) return { ok: false, code: failure.code, created, entity: failure.entity };
  return { ok: true, created, kept, mapping: saved.mapping };
}

/**
 * Validate pasted database ids and, only when every one passes, save them
 * over the existing mapping.
 *
 * Each value may be a bare id, a dashed uuid or a Notion URL. A value that is
 * not one is `invalid_database_id`; a database Notion cannot find (or that is
 * archived) is `database_not_found`; one without the expected properties is
 * `schema_mismatch`, with which properties are missing or of the wrong type. A
 * relation is checked against the database its target will map to once this
 * paste is saved. Blank values are ignored — they leave that entity as it is.
 *
 * An entity whose database changes loses its `mirror_pages` rows, and the next
 * push is a full one.
 */
export async function applyPastedMapping(
  mirrorId: string,
  pasted: Partial<Record<MirrorEntity, string>>,
  options: MirrorDatabaseOptions = {}
): Promise<ApplyMappingResult> {
  const db = options.db ?? (await getDb());
  const problems: MappingProblem[] = [];
  const parsed: MirrorMapping = {};
  for (const entity of MIRROR_ENTITY) {
    const value = pasted[entity];
    if (typeof value !== "string" || value.trim() === "") continue;
    const id = parseNotionId(value);
    if (id) parsed[entity] = id;
    else problems.push({ entity, code: "invalid_database_id" });
  }
  if (problems.length) return { ok: false, code: "invalid_database_id", problems };
  if (Object.keys(parsed).length === 0) return { ok: false, code: "invalid_database_id", problems: [] };

  const opened = await openMirror(mirrorId, options, db);
  if (!opened.ok) return { ok: false, code: opened.code, problems: [] };
  const merged: MirrorMapping = { ...opened.mapping, ...parsed };

  for (const entity of MIRROR_ENTITY) {
    const id = parsed[entity];
    if (!id) continue;
    let database: NotionDatabaseObject;
    try {
      database = await opened.client.getDatabase(id);
    } catch (error) {
      const code = setupErrorFor(error, "database_not_found");
      if (code !== "database_not_found") return { ok: false, code, problems: [] };
      problems.push({ entity, code: "database_not_found" });
      continue;
    }
    if (isGone(database)) {
      problems.push({ entity, code: "database_not_found" });
      continue;
    }
    const problem = validateDatabaseSchema(entity, database, merged);
    if (problem) problems.push(problem);
  }
  if (problems.length) return { ok: false, code: problems[0].code, problems };

  const changed = MIRROR_ENTITY.filter(
    (entity) => parsed[entity] && normalizeDatabaseId(opened.mapping[entity]) !== parsed[entity]
  );
  if (changed.length) await resetMirrorEntities(mirrorId, changed, { db });
  const saved = await setMirrorMapping(mirrorId, merged, { db });
  return { ok: true, mapping: saved.mapping };
}
