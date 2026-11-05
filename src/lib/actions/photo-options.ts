import "server-only";

import { z } from "zod";
import type { CoverPayload } from "../inventory/photo-edits";
import type { InventoryWriteResult } from "../inventory/result";
import { PHOTO_NOTE_MAX_CHARS } from "../photo-options/candidates";
import { requestPhotoOptions } from "../photo-options/request";
import { cleanReviewerNote } from "../intake/reviewer-note";
import { pickPhotoOption } from "../photo-options/pick";
import {
  INVENTORY_REVALIDATE,
  inventoryOutcome,
  tellMirror,
  toolRef,
  toolRevisionInput,
  writeContext,
  type InventoryRefusal,
  type InventoryValue,
  type ToolRevisionInput,
} from "./catalog-write";
import { defineAction } from "./define";

/**
 * **Photo options** for a catalogue tool (photo options spec 2026-10-29): find
 * candidate cover pictures, then make one the cover. The tool editor's Photos
 * section runs both; the assistant does not offer them.
 *
 * - **`photos.find_options`** spends one item of the caller's research
 *   allowance and starts the background search. It changes no photo.
 * - **`photos.use_option`** downloads one of a search's pictures (only a URL
 *   the search recorded), cleans it unless told not to, and makes it the cover
 *   at the panel's revision. With `replaceCover` (the default) the old cover is
 *   released.
 */

type PhotoRefusal = "invalid_field" | "not_found" | "photo_search_running" | "daily_limit" | "start_failed";

const NEVER = "A picker of web pictures the person looks at in the tool editor, not a sentence (photo options spec 2026-10-29)";

/** The note as stored and sent: one clean line, or null; over the cap is a refusal, never a cut. */
function photoNote(raw: string | null | undefined): string | null | "too_long" {
  const line = cleanReviewerNote(raw ?? "");
  if (!line) return null;
  return line.length > PHOTO_NOTE_MAX_CHARS ? "too_long" : line;
}

export const PHOTOS_FIND_OPTIONS = defineAction<{ toolId: string; note?: string | null }, { searchId: string }, PhotoRefusal>({
  id: "photos.find_options",
  toolName: "find_photo_options",
  description: "Search the web for better cover photos of a catalogue tool. Costs one research item.",
  permission: "tools.edit",
  risk: "spend",
  assistant: "never",
  neverReason: NEVER,
  input: z.strictObject({ toolId: z.string().min(1).max(200), note: z.string().max(4000).nullable().optional() }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  run: async (input, ctx) => {
    const userId = ctx.identity.userId;
    if (!userId) return { ok: false, error: "not_signed_in" };
    const tool = await toolRef(input.toolId);
    if (!tool) return { ok: false, error: "not_found" };
    const note = photoNote(input.note);
    if (note === "too_long") return { ok: false, error: "invalid_field" };
    const result = await requestPhotoOptions({ userId }, { toolId: tool.id, note });
    return result.ok ? { ok: true, value: { searchId: result.searchId }, committed: true } : { ok: false, error: result.error };
  },
});

type UseInput = ToolRevisionInput & { searchId: string; url: string; removeBackground?: boolean; replaceCover?: boolean };

export const PHOTOS_USE_OPTION = defineAction<UseInput, InventoryValue<CoverPayload>, InventoryRefusal | "photo_unavailable">({
  id: "photos.use_option",
  toolName: "use_photo_option",
  description: "Make one of a tool's photo options its cover photo.",
  permission: "tools.edit",
  risk: "catalog",
  assistant: "never",
  neverReason: NEVER,
  input: toolRevisionInput.extend({
    searchId: z.string().min(1).max(64),
    url: z.string().url().max(2048),
    removeBackground: z.boolean().optional(),
    replaceCover: z.boolean().optional(),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  run: async (input, ctx) => {
    const result = await pickPhotoOption(writeContext(input, ctx), {
      searchId: input.searchId,
      url: input.url,
      removeBackground: input.removeBackground !== false,
      replaceCover: input.replaceCover !== false,
    });
    if (!result.ok && result.error === "photo_unavailable") return { ok: false, error: "photo_unavailable" };
    return inventoryOutcome(result as InventoryWriteResult<CoverPayload>);
  },
  afterCommit: tellMirror,
  revalidate: INVENTORY_REVALIDATE,
});
