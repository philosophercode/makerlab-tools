import "server-only";

import { z } from "zod";
import { getPhotoSearch } from "../data/photo-searches";
import { getDb } from "../db/client";
import { listAttachmentsForOwner } from "../data/attachments";
import type { CoverPayload } from "../inventory/photo-edits";
import type { InventoryWriteResult } from "../inventory/result";
import { PHOTO_NOTE_MAX_CHARS } from "../photo-options/candidates";
import { requestPhotoOptions } from "../photo-options/request";
import { PHOTO_OPTIONS_MAX, photoOptionHost } from "../photo-options/types";
import { cleanReviewerNote } from "../intake/reviewer-note";
import { pickPhotoOption } from "../photo-options/pick";
import { allowanceLeft } from "./allowance";
import {
  INVENTORY_REVALIDATE,
  inventoryOutcome,
  revisionInputFor,
  tellMirror,
  TOOL_REF,
  toolPage,
  toolRef,
  toolRevisionInput,
  writeContext,
  type InventoryRefusal,
  type InventoryValue,
  type ToolRevisionInput,
} from "./catalog-write";
import { defineAction, toolShape } from "./define";

/**
 * **Photo options** for a catalogue tool (photo options spec 2026-10-29): find
 * candidate cover pictures, then make one the cover. The tool editor's Photos
 * section and the assistant run the same two definitions.
 *
 * - **`photos.find_options`** spends one item of the caller's research
 *   allowance (a card with the person's click, never over MCP — as **Find a
 *   different image**), and starts the background search. It changes no photo.
 * - **`photos.use_option`** downloads one of the latest search's pictures
 *   (only a URL the search recorded), cleans it unless told not to, and makes
 *   it the cover at the panel's revision — the editor's own photo write. With
 *   `replaceCover` (the default) the old cover is released.
 *
 * `tools.edit`, like every editor write. Uploading and reordering stay the
 * panel's (§2 of the parity spec: a file is not a sentence) — a found picture
 * is a URL the search recorded, which is.
 */

type PhotoRefusal = "invalid_field" | "not_found" | "photo_search_running" | "daily_limit" | "start_failed";

const NOTE = z.string().max(4000).nullable().optional();

/** The note as stored and sent: one clean line, or null; over the cap is a refusal, never a cut. */
function photoNote(raw: string | null | undefined): string | null | "too_long" {
  const line = cleanReviewerNote(raw ?? "");
  if (!line) return null;
  return line.length > PHOTO_NOTE_MAX_CHARS ? "too_long" : line;
}

// ── photos.find_options ─────────────────────────────────────────────

export const PHOTOS_FIND_OPTIONS = defineAction<{ toolId: string; note?: string | null }, { searchId: string }, PhotoRefusal>({
  id: "photos.find_options",
  toolName: "find_photo_options",
  description:
    "Search the web for better cover photos of a catalogue tool — the manufacturer's own clean product shots first, never the pictures already offered. Optionally with a one-line note (\"the white-background photo from the maker's site\"). Costs one research item from today's allowance and changes no photo: the options appear in the tool editor's Photos section (and get_photo_options) for the person to pick. Proposes the search; nothing starts until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "spend",
  input: z.strictObject({ toolId: z.string().min(1).max(200), note: NOTE }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(
    z.strictObject({
      tool_id: TOOL_REF,
      note: z.string().max(PHOTO_NOTE_MAX_CHARS).optional().describe("One line for the photo search, only if the person gave one"),
    }),
    async (args) => {
      const tool = await toolRef(args.tool_id);
      return { ok: true, inputs: [{ toolId: tool?.id ?? args.tool_id, note: args.note ?? null }] };
    }
  ),
  preview: async (input, ctx) => {
    const tool = await toolRef(input.toolId);
    if (!tool) return null;
    return {
      summary: { key: "photos_find_options", values: { name: tool.name, left: await allowanceLeft(ctx) } },
      rows: input.note ? [{ field: "photoNote", before: null, after: input.note }] : [],
      subjectName: tool.name,
      link: toolPage(tool.slug),
    };
  },
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

// ── photos.use_option ───────────────────────────────────────────────

type UseInput = ToolRevisionInput & { searchId: string; url: string; removeBackground?: boolean; replaceCover?: boolean };

export const PHOTOS_USE_OPTION = defineAction<UseInput, InventoryValue<CoverPayload>, InventoryRefusal | "photo_unavailable">({
  id: "photos.use_option",
  toolName: "use_photo_option",
  description:
    "Make one of a tool's photo options (from get_photo_options, by its number and that list's search_id) the tool's cover photo. By default its background is removed the way intake cleans a product photo, and the old cover is removed; say so to keep either. Proposes the change; nothing changes until the person confirms it on the card.",
  permission: "tools.edit",
  risk: "catalog",
  input: toolRevisionInput.extend({
    searchId: z.string().min(1).max(64),
    url: z.string().url().max(2048),
    removeBackground: z.boolean().optional(),
    replaceCover: z.boolean().optional(),
  }),
  invalidInput: "invalid_field",
  subject: (input) => ({ type: "tool", id: input.toolId }),
  tool: toolShape(
    z.strictObject({
      tool_id: TOOL_REF,
      search_id: z.string().min(1).max(64).describe("The search_id get_photo_options returned with the list the number is from"),
      option: z.number().int().min(1).max(PHOTO_OPTIONS_MAX).describe("The option's number, as get_photo_options lists it"),
      remove_background: z.boolean().optional().describe("false to keep the picture's own background (default true)"),
      replace_cover: z.boolean().optional().describe("false to keep the current cover as a second photo (default true)"),
    }),
    async (args) => {
      const ref = await revisionInputFor(args.tool_id);
      // The number is read against the list it came from, never a newer search's
      // — a search that finished in between would otherwise swap the picture.
      const search = await getPhotoSearch(args.search_id);
      const option = search?.toolId === ref.toolId && search.status === "ready" ? search.options[args.option - 1] : undefined;
      if (!search || !option) return { ok: false, error: "photo_options_not_ready" };
      return {
        ok: true,
        inputs: [
          {
            ...ref,
            searchId: search.id,
            url: option.url,
            removeBackground: args.remove_background ?? true,
            replaceCover: args.replace_cover ?? true,
          },
        ],
      };
    }
  ),
  preview: async (input) => {
    if (!input.expectedRevision) return null;
    const tool = await toolRef(input.toolId);
    if (!tool) return null;
    const search = await getPhotoSearch(input.searchId);
    const index = search?.toolId === tool.id ? search.options.findIndex((option) => option.url === input.url) : -1;
    if (!search || index < 0) return null;
    const photos = await listAttachmentsForOwner(await getDb(), { ownerType: "tool", ownerId: tool.id });
    const cover = photos[0] ? (photos[0].originalFilename ?? "photo") : null;
    const host = photoOptionHost(search.options[index]);
    return {
      summary: { key: "photos_use_option", values: { name: tool.name, option: index + 1, host } },
      rows: [
        { field: "coverPhoto", before: cover, after: `Option ${index + 1} (${host})` },
        { field: "removeBackground", before: null, after: input.removeBackground === false ? "no" : "yes" },
        ...(cover ? [{ field: "oldCover", before: null, after: input.replaceCover === false ? "kept" : "removed" }] : []),
      ],
      subjectName: tool.name,
      link: toolPage(tool.slug),
    };
  },
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
