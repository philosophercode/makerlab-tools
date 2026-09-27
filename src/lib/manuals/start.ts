import { start } from "workflow/api";
import { archiveManuals } from "../../workflows/archive-manuals.ts";

/**
 * Starting `archiveManuals` — the one module that imports `workflow/api` for
 * the manual archive. Callers reach it through `trigger.ts`'s dynamic
 * `import()`, so a write with no resources to archive never loads the
 * workflow runtime.
 *
 * True when the run was started. Starting is not archiving: what each
 * resource came to is in the run's result and its log line.
 */
export async function startManualArchive(resourceIds: readonly string[]): Promise<boolean> {
  try {
    await start(archiveManuals, [[...resourceIds]]);
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown error";
    console.error(`[manuals] could not start an archive run for ${resourceIds.length} resource(s): ${name}`);
    return false;
  }
}
