import type { ManualOutlineForPrompt } from "../capabilities/types";
import { listToolManualsForChat } from "../data/manual-chunks";
import { getDb } from "../db/client";
import { canSearchPrivateManuals, type ManualSearchViewer } from "../manuals/search";

/**
 * What the chat needs to know about the focused tool's manuals (manual text
 * spec §3.6):
 *
 * - `outlines` — its **searchable** manuals (ready, with passages) and their
 *   contents, for the system prompt, so the model knows what each covers
 *   before it calls `search_manual`;
 * - `searchableResourceIds` — the resources those belong to. The route never
 *   attaches their PDFs: whole-PDF attachment is only the fallback for a
 *   manual that is `no_text`, `failed` or not processed yet, and
 *   `MAX_PDFS_PER_CHAT` counts only those.
 *
 * Access is the search's own: lab staff see private and hidden manuals, anyone
 * else only public ones on published resources. A database failure is not the
 * chat's failure — it answers "nothing searchable", and the manuals fall back
 * to attachment exactly as before phase 2.
 */
export interface ToolManualsForChat {
  outlines: ManualOutlineForPrompt[];
  searchableResourceIds: Set<string>;
}

export async function loadToolManualsForChat(
  toolId: string,
  viewer: ManualSearchViewer
): Promise<ToolManualsForChat> {
  try {
    const db = await getDb();
    const manuals = await listToolManualsForChat(db, toolId, { includePrivate: canSearchPrivateManuals(viewer) });
    const searchable = manuals.filter((manual) => manual.searchable);
    return {
      outlines: searchable.map((manual) => ({
        title: manual.title,
        pageCount: manual.pageCount,
        pdfUrl: manual.pdfUrl,
        outline: manual.outline,
      })),
      searchableResourceIds: new Set(searchable.map((manual) => manual.resourceId)),
    };
  } catch (error) {
    console.warn(`[chat] manual search state unavailable; manuals fall back to attachment: ${error instanceof Error ? error.name : "error"}`);
    return { outlines: [], searchableResourceIds: new Set() };
  }
}
