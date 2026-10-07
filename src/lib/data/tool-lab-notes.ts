import { and, asc, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { labNoteLines } from "../lab-notes/lines.ts";

/**
 * Every tool that has lab notes (identity spec amendment "Lab notes"): the
 * list `/admin/inventory/lab-notes` shows under the lab-wide notes, so staff
 * see all of the lab's own knowledge in one place. A tool's lab notes are its
 * `tools.notes` column, edited in the tool editor.
 *
 * Archived tools are left out; drafts are in, marked, since staff may write a
 * tool's notes before it is published. By name. Relative imports with `.ts`
 * extensions: `scripts/` may load this under plain Node.
 */

export interface ToolWithLabNotes {
  id: string;
  slug: string;
  name: string;
  published: boolean;
  /** The notes as the page and the assistant read them, one per line. */
  lines: string[];
}

export async function listToolsWithLabNotes(db: Db): Promise<ToolWithLabNotes[]> {
  const rows = await db
    .select({ id: tools.id, slug: tools.slug, name: tools.name, published: tools.published, notes: tools.notes })
    .from(tools)
    .where(and(isNull(tools.archivedAt), isNotNull(tools.notes), ne(sql`btrim(${tools.notes})`, "")))
    .orderBy(asc(tools.name));
  return rows
    .map((row) => ({ id: row.id, slug: row.slug, name: row.name, published: row.published, lines: labNoteLines(row.notes) }))
    .filter((row) => row.lines.length > 0);
}
