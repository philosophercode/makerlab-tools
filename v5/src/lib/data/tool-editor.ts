import { listAttachmentsForOwner } from "./attachments.ts";
import { listResourcesForEditor, type EditorResource } from "./resources.ts";
import { findToolForEditor, type EditableTool } from "./tools.ts";
import { listUnitsForTool, type UnitRecord } from "./units.ts";
import { getDb } from "../db/client.ts";
import type { Db } from "../db/types.ts";

/**
 * Everything the tool editor panel shows, read in one place (spec §5.3(3)).
 *
 * The panel is one form over four tables, and the four reads belong to four
 * modules — `tools.ts` for the fields and the revision token, `units.ts`,
 * `resources.ts`, `attachments.ts`. This composes them; it holds no SQL of its
 * own, the way `src/lib/catalog.ts` composes `data/catalog.ts` without
 * duplicating it.
 *
 * **It is deliberately not the catalogue's read.** Everything here is the
 * version a *reviewer* needs: drafts and archived tools, retired units,
 * unpublished resources, and the raw column values rather than the derived
 * prose a visitor sees. Widening `data/catalog.ts` with an "include everything"
 * flag is how a draft ends up on the public gallery.
 *
 * **The revision token is minted here**, by `findToolForEditor`, which is what
 * makes the conflict check mean "changed while you had it open" rather than
 * "changed since this page was cached". The panel loads through this on open,
 * never from whatever the page it sits on already had.
 *
 * Relative imports with `.ts` extensions and no `@/` alias, and no
 * `"server-only"`: `scripts/` loads these modules under plain Node.
 */

/** One of the tool's photos, cover first (`position` 0 is the cover, §4.7). */
export interface EditorPhoto {
  id: string;
  /** The public URL, or null for a file with no reachable URL. */
  url: string | null;
  originalFilename: string | null;
}

/** The whole panel's data, plus the token its next write will carry. */
export interface ToolEditorData {
  tool: EditableTool;
  units: UnitRecord[];
  resources: EditorResource[];
  photos: EditorPhoto[];
}

export interface ToolEditorReadOptions {
  /** A handle to use instead of {@link getDb} — tests pass an isolated one. */
  db?: Db;
}

/**
 * Load one tool for the editor, by slug or uuid. Null when there is no such
 * tool — which the panel reports as `not_found`, not as an empty form.
 *
 * Four statements plus the resources' files: the tool is read first because
 * the other three are keyed on its id, and because a missing tool is the one
 * case where none of them is worth running at all.
 */
export async function loadToolEditor(
  idOrSlug: string,
  options: ToolEditorReadOptions = {}
): Promise<ToolEditorData | null> {
  const db = options.db ?? (await getDb());

  const tool = await findToolForEditor(idOrSlug, { db });
  if (!tool) return null;

  const [units, resources, photos] = await Promise.all([
    listUnitsForTool(db, tool.id),
    listResourcesForEditor(db, tool.id),
    listAttachmentsForOwner(db, { ownerType: "tool", ownerId: tool.id }),
  ]);

  return {
    tool,
    units,
    resources,
    photos: photos.map((photo) => ({
      id: photo.id,
      url: photo.publicUrl,
      originalFilename: photo.originalFilename,
    })),
  };
}
