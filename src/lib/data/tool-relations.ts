import { and, asc, isNull, ne } from "drizzle-orm";
import { tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * Accessory → tool links (taxonomy v2 facet `tools.parent_tool_id`).
 *
 * One level only: a parent is never itself an accessory, so there is no chain
 * and no cycle (`updateTool` refuses anything else). Relative imports with
 * `.ts` extensions: `scripts/` may load this under plain Node.
 */

/** A tool the editor's "Accessory of" picker offers. */
export interface ParentToolOption {
  id: string;
  name: string;
}

/**
 * Every tool that may be `toolId`'s parent: not archived, not itself an
 * accessory of another, and not `toolId`. Drafts included — an accessory may
 * be recorded before its tool is published. By name.
 */
export async function listParentToolOptions(db: Db, toolId: string): Promise<ParentToolOption[]> {
  const where = and(isNull(tools.archivedAt), isNull(tools.parentToolId), isUuid(toolId) ? ne(tools.id, toolId) : undefined);
  return db.select({ id: tools.id, name: tools.name }).from(tools).where(where).orderBy(asc(tools.name));
}
