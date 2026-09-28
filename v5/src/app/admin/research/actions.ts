"use server";

import { MANUALS_REPROCESS_LIBRARY } from "../../../lib/actions/manuals";
import { performAction } from "../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";
import type { ReprocessManualResult } from "./action-result";

/**
 * **Re-process** from the Manuals page (manual text spec §5; public polish):
 * the tool editor's action, offered where the library is listed, so a failed
 * or stale manual is one click from the row that shows it.
 *
 * A one-line wrapper over `manuals.reprocess_library`
 * (`src/lib/actions/manuals.ts`): `tools.edit`, then the resource's current
 * PDFs are marked as built by no version (nothing is deleted: the stored text
 * keeps serving until the new one replaces it) and the archive workflow is
 * asked to run. The start never throws; a start that fails leaves the
 * documents marked for the next nightly run.
 */
export async function reprocessLibraryManual(input: { resourceId: string }): Promise<ReprocessManualResult> {
  return performAction(MANUALS_REPROCESS_LIBRARY, input, await resolveIdentityFromHeaders(), { surface: "gui" });
}
