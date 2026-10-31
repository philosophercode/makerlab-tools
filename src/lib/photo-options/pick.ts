import "server-only";
import type { BlobStore } from "../blob";
import { getPhotoSearch, recordPhotoChoice } from "../data/photo-searches";
import type { Db } from "../db/types";
import { pickHints, storeResearchImage } from "../intake/approval-image";
import { setCoverPhoto, type CoverPayload } from "../inventory/photo-edits";
import type { InventoryWriteResult } from "../inventory/result";
import type { ToolWriteContext } from "../inventory/tool-transaction";

/**
 * **Use this photo** — one of a search's options becomes the tool's cover
 * (photo options spec 2026-10-29 §4).
 *
 * - **Only a URL the search recorded**, exactly, for this tool: this is where
 *   a browser (or a model) names a picture the server then downloads, and "only
 *   what the search found" is the whole SSRF rule, as for an intake approval's
 *   "original". Anything else is `invalid_field` and nothing is fetched.
 * - **Downloaded and cleaned now**, through the approval image path
 *   (`storeResearchImage`: the guarded fetch, JPEG/PNG/WebP only, stored public
 *   as a `research_image` with its source URL). With `removeBackground` (the
 *   default) it gets the same deterministic crop and cutout a picked intake
 *   image gets, from what the ranking recorded — never a generative redraw;
 *   off, it is stored exactly as downloaded.
 * - **Then the editor's own write** (`setCoverPhoto`, at the panel's
 *   revision): claimed, put first, and with `replaceCover` the old cover is
 *   released for the nightly sweep. A conflict writes nothing; the stored copy
 *   is left unowned, and the 24-hour orphan sweep deletes it.
 * - **A picture that cannot be downloaded** is `photo_unavailable` — nothing
 *   was written, so it is a refusal, and the person picks another.
 */

export type PickPhotoRefusal = "invalid_field" | "not_found" | "photo_unavailable";

export async function pickPhotoOption(
  context: ToolWriteContext,
  input: { searchId: string; url: string; removeBackground: boolean; replaceCover: boolean },
  options: { db?: Db; store?: BlobStore | null } = {}
): Promise<InventoryWriteResult<CoverPayload> | { ok: false; error: PickPhotoRefusal }> {
  const search = await getPhotoSearch(input.searchId, { db: options.db ?? context.db });
  if (!search || search.toolId !== context.toolId) return { ok: false, error: "not_found" };
  const option = search.options.find((candidate) => candidate.url === input.url);
  if (!option) return { ok: false, error: "invalid_field" };
  if (!context.actorUserId) return { ok: false, error: "invalid_field" };

  const attachmentId = await storeResearchImage(
    option.url,
    { uploadedBy: context.actorUserId, db: options.db ?? context.db, store: options.store },
    input.removeBackground ? pickHints(option) : null
  );
  if (!attachmentId) return { ok: false, error: "photo_unavailable" };

  const result = await setCoverPhoto(context, attachmentId, { replace: input.replaceCover });
  if (result.ok) {
    // The cover landed; the record of which option it was is a nicety.
    await recordPhotoChoice(search.id, option.url, context.actorUserId, { db: options.db ?? context.db }).catch((error: unknown) => {
      console.warn(`[photo-options] could not record the pick on search ${search.id}`, error);
    });
  }
  return result;
}
