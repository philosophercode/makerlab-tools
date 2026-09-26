"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import { markResourceManualsStale } from "../../../lib/data/manual-chunks";
import { isUuid } from "../../../lib/data/uuid";
import { getDb } from "../../../lib/db/client";
import { resources } from "../../../lib/db/schema/index";
import { requestManualArchive } from "../../../lib/manuals/trigger";
import { MANUALS_PATH, type ReprocessManualResult } from "./action-result";

/**
 * **Re-process** from the Manuals page (manual text spec §5; public polish):
 * the tool editor's action, offered where the library is listed, so a failed
 * or stale manual is one click from the row that shows it.
 *
 * It checks `tools.edit` for itself — the permission the page and the editor's
 * own Re-process check — then marks the resource's current PDFs as built by no
 * version (nothing is deleted: the stored text keeps serving until the new one
 * replaces it) and asks the archive workflow to run. The start never throws; a
 * start that fails leaves the documents marked for the next nightly run.
 */
export async function reprocessLibraryManual(input: { resourceId: string }): Promise<ReprocessManualResult> {
  const gate = await authorizeAdminAction("tools.edit");
  if (!gate.ok) return gate;
  if (!isUuid(input.resourceId)) return { ok: false, error: "not_found" };
  try {
    const db = await getDb();
    const [row] = await db.select({ id: resources.id }).from(resources).where(eq(resources.id, input.resourceId));
    if (!row) return { ok: false, error: "not_found" };
    await markResourceManualsStale(db, input.resourceId);
  } catch (err) {
    console.error("[admin/research] re-process failed", err);
    return { ok: false, error: "failed" };
  }
  await requestManualArchive([input.resourceId]);
  revalidatePath(MANUALS_PATH);
  return { ok: true };
}
