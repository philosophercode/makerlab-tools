"use server";

import { performAction } from "../../../lib/actions/perform";
import { PHOTOS_FIND_OPTIONS, PHOTOS_USE_OPTION } from "../../../lib/actions/photo-options";
import { authorizeAdminView } from "../../../lib/admin/action-gate";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import { latestPhotoSearch } from "../../../lib/data/photo-searches";
import { findToolForEditor } from "../../../lib/data/tools";
import type { CoverPayload } from "../../../lib/inventory/photo-edits";
import type { InventoryActionResult } from "./action-result";
import type { FindPhotoOptionsResult, LoadPhotoOptionsResult } from "./photo-option-result";
import type { ToolWriteInput } from "./tool-write-context";

/**
 * **Photo options** in the tool editor's Photos section (photo options spec
 * 2026-10-29): find candidate cover pictures, poll for them, use one.
 *
 * The two writes are one-line wrappers over `photos.find_options` and
 * `photos.use_option` (`src/lib/actions/photo-options.ts`), the same
 * definitions the assistant proposes; the read is the panel's poll.
 */

/** Start a search. `tools.edit`; one item of today's research allowance. */
export async function findPhotoOptions(input: { toolId: string; note?: string | null }): Promise<FindPhotoOptionsResult> {
  return performAction(PHOTOS_FIND_OPTIONS, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** Make one option the cover, at the panel's revision. */
export async function pickPhotoOption(
  input: ToolWriteInput & { searchId: string; url: string; removeBackground?: boolean; replaceCover?: boolean }
): Promise<InventoryActionResult<CoverPayload>> {
  return performAction(PHOTOS_USE_OPTION, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}

/** The tool's latest search — what the section shows, and polls while it runs. */
export async function loadPhotoOptions(idOrSlug: string): Promise<LoadPhotoOptionsResult> {
  const gate = await authorizeAdminView("tools.edit");
  if (!gate.ok) return gate;
  const tool = await findToolForEditor(idOrSlug);
  if (!tool) return { ok: false, error: "not_found" };
  return { ok: true, search: await latestPhotoSearch(tool.id) };
}
