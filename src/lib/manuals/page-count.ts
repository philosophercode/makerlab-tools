import { getDocumentProxy } from "unpdf";

/**
 * A PDF's page count, or null when pdf.js cannot open it. Used by the eval's
 * citation evidence and by the chat route, which bounds the pages an attached
 * manual may be cited at (manual text spec amendment 2026-09-28b).
 */
export async function countPages(bytes: Uint8Array): Promise<number | null> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes), {
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0,
    } as Parameters<typeof getDocumentProxy>[1]);
    try {
      return pdf.numPages;
    } finally {
      void pdf.loadingTask.destroy().catch(() => {});
    }
  } catch {
    return null;
  }
}
