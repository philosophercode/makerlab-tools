import { asc } from "drizzle-orm";
import { tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isNameTaken } from "../tool-names.ts";

/**
 * Display names are unique across tools (display names amendment 2026-09-25):
 * compared case-, spacing- and punctuation-insensitively (`normalizeName`), so
 * "Ryobi ONE+ Battery" and "ryobi one battery" are the same name. Archived
 * tools and drafts count — they are still rows a person can find, restore and
 * print a label for.
 *
 * There is no database index behind it: the rule is a normalization in code,
 * and the inventory imported before it may hold pairs the index would refuse
 * to build over. Every write path checks here first — the editor's save
 * (`updateTool`), intake approval, MCP `create_tool`, the backfill — so a
 * duplicate is a named refusal (`duplicate_name`), never a surprise on a card.
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

/** Every tool's id and display name, archived and drafts included, by name. */
export async function listToolNames(db: Db): Promise<{ id: string; name: string }[]> {
  return db.select({ id: tools.id, name: tools.name }).from(tools).orderBy(asc(tools.name));
}

/** The other tools' display names — every tool's but `exceptId`'s. */
export async function otherToolNames(db: Db, exceptId: string | null = null): Promise<string[]> {
  return (await listToolNames(db)).filter((row) => row.id !== exceptId).map((row) => row.name);
}

/**
 * True when `name` is already another tool's display name. `exceptId` is the
 * tool being renamed, so saving its own name again is never a clash.
 */
export async function displayNameClashes(db: Db, name: string, exceptId: string | null = null): Promise<boolean> {
  return isNameTaken(name, await otherToolNames(db, exceptId));
}
