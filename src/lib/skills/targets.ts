import { sql } from "drizzle-orm";
import { isUuid } from "../data/uuid.ts";
import { rawRows } from "../db/raw.ts";
import type { Db } from "../db/types.ts";

/**
 * The machines these manual documents belong to (tool skills spec 2026-10-07
 * §5.4): each document's resource's tool, else the tool the document records,
 * archived tools left out. In the order the documents were given, each tool
 * once. The archive workflow's tail asks it which skills to refresh after it
 * built passages. Plain Node.
 */
export async function toolIdsForDocuments(db: Db, documentIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(documentIds.filter(isUuid))];
  if (ids.length === 0) return [];
  const rows = await rawRows<{ document_id: string; tool_id: string | null }>(
    db,
    sql`select d.id as document_id, coalesce(r.tool_id, d.tool_id) as tool_id
          from manual_documents d
          join attachments a on a.id = d.attachment_id
          left join resources r on a.owner_type = 'resource' and r.id = a.owner_id
          join tools t on t.id = coalesce(r.tool_id, d.tool_id)
         where t.archived_at is null
           and d.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})`
  );
  const byDocument = new Map(rows.map((row) => [row.document_id, row.tool_id]));
  const out: string[] = [];
  for (const id of ids) {
    const toolId = byDocument.get(id);
    if (toolId && !out.includes(toolId)) out.push(toolId);
  }
  return out;
}
