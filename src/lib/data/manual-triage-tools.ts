import { inArray } from "drizzle-orm";
import type { TriageSourceTool } from "../actions/manual-triage.ts";
import { getDb } from "../db/client.ts";
import { tools } from "../db/schema/index.ts";
import type { Db } from "../db/types.ts";
import { thumbnailUrl } from "../images/thumbnail-urls.ts";
import { selectCoverPhotos } from "./inventory.ts";
import { listResourcesForEditor } from "./resources.ts";
import { isUuid } from "./uuid.ts";

/**
 * What the Manuals view of `/admin/proposals` shows beside each tool's
 * proposals (assistant–GUI parity spec, amendment 2026-10-07): its name, a
 * small picture, and every document it has now, hidden ones included (the
 * editor's own read, `listResourcesForEditor`).
 *
 * Reads only the tools the open proposals name: one statement for the names,
 * one for the pictures, and the editor's read per tool, all at once. Nothing
 * here fetches a document: page counts come from the manual archive's stored
 * copy, when it has one.
 *
 * Relative imports with `.ts` extensions, like every module under `data/`.
 */
export async function loadTriageTools(toolIds: readonly string[], options: { db?: Db } = {}): Promise<Map<string, TriageSourceTool>> {
  const ids = [...new Set(toolIds.filter(isUuid))];
  const out = new Map<string, TriageSourceTool>();
  if (ids.length === 0) return out;
  const db = options.db ?? (await getDb());

  const [rows, photos, documents] = await Promise.all([
    db.select({ id: tools.id, slug: tools.slug, name: tools.name }).from(tools).where(inArray(tools.id, ids)),
    selectCoverPhotos(db, ids),
    Promise.all(ids.map(async (id) => [id, await listResourcesForEditor(db, id)] as const)),
  ]);
  const docsByTool = new Map(documents);
  for (const row of rows) {
    const photo = photos.get(row.id);
    out.set(row.id, {
      name: row.name,
      slug: row.slug,
      // The smallest pre-rendered width when there is one: the view shows a 40px picture.
      photo: photo ? (photo.thumbnails ? thumbnailUrl(photo.thumbnails, photo.thumbnails.widths[0], "webp") : photo.url) : null,
      documents: docsByTool.get(row.id) ?? [],
    });
  }
  return out;
}
