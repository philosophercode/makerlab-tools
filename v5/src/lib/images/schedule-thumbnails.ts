import "server-only";

import { after } from "next/server";
import { invalidateCatalog, invalidateProjects } from "../revalidate";
import { ensureThumbnails } from "./attachment-thumbnails";

/**
 * Write thumbnails for newly public images **after the response is sent**
 * (`after()`), so the person uploading or approving never waits for the
 * encoder. When any were written, the catalogue and project caches are
 * dropped so pages pick them up; until then they show the original through
 * `next/image`.
 *
 * Outside a request (a test, a script) `after()` is unavailable and the work
 * runs detached instead; with no Blob store it does nothing at all.
 */
export function scheduleThumbnails(filter: Parameters<typeof ensureThumbnails>[0]): void {
  const task = async () => {
    const { written } = await ensureThumbnails(filter);
    if (written === 0) return;
    try {
      invalidateCatalog();
      invalidateProjects();
    } catch (err) {
      console.error("[thumbnails] written, but the caches could not be invalidated", err);
    }
  };
  try {
    after(task);
  } catch {
    void task().catch((err: unknown) => console.error("[thumbnails] background run failed", err));
  }
}
