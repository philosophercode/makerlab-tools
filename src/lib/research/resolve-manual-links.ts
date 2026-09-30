import { directDownloadUrl, isPdfPath } from "../manuals/pdf-links.ts";
import { resolveManualPdf, type ResolvedManual } from "../manuals/resolve-pdf.ts";

/**
 * Research's last step one hop further (manual text spec amendment 2026-09-28
 * "Follow the download page to the PDF"): a verified **Manual** link that is
 * not a PDF — a support page with the manual in a viewer, a Download button,
 * a Drive or Dropbox share — is resolved to the PDF (`manuals/resolve-pdf.ts`).
 * When it resolves, the Manual becomes the PDF's address, and the page it was
 * found on is kept beside it as an "Other" link titled "… — download page",
 * so the reviewer sees both and the archiver can copy the file.
 *
 * At most {@link MAX_MANUALS_RESOLVED} links a run, in order; a link that does
 * not resolve is kept exactly as it was. The step's deadline aborting is
 * rethrown (running out of time is not a verdict on the link).
 *
 * Plain Node: step code imports it.
 */

export const MAX_MANUALS_RESOLVED = 2;

export interface LinkLike {
  title: string;
  url: string;
  type: string;
}

export interface ResolveLinksOptions {
  signal?: AbortSignal;
  /** Injected in tests; the real resolver otherwise. */
  resolve?: (url: string, signal?: AbortSignal) => Promise<ResolvedManual>;
}

export interface ResolveLinksResult<T extends LinkLike> {
  links: T[];
  /** One line per link that moved: "Manual … → PDF … (via …)". For the log, hosts only. */
  notes: string[];
}

/** A Manual link worth resolving: not a PDF address, or a share/viewer link that hides one. */
export function needsResolving(link: LinkLike): boolean {
  if (link.type.trim().toLowerCase() !== "manual") return false;
  if (!/^https?:\/\//i.test(link.url)) return false;
  return !isPdfPath(link.url) || directDownloadUrl(link.url) !== null;
}

export async function resolveManualLinks<T extends LinkLike>(
  links: readonly T[],
  options: ResolveLinksOptions = {}
): Promise<ResolveLinksResult<T>> {
  const resolve = options.resolve ?? ((url: string, signal?: AbortSignal) => resolveManualPdf(url, { signal }));
  const out: T[] = [...links];
  const notes: string[] = [];
  let attempts = 0;
  for (let i = 0; i < out.length && attempts < MAX_MANUALS_RESOLVED; i += 1) {
    const link = out[i];
    if (!needsResolving(link)) continue;
    attempts += 1;
    let result: ResolvedManual;
    try {
      result = await resolve(link.url, options.signal);
    } catch (error) {
      options.signal?.throwIfAborted();
      notes.push(`${hostOf(link.url)}: not resolved (${error instanceof Error ? error.name : "error"})`);
      continue;
    }
    if (result.status !== "pdf" || result.pdfUrl === link.url) continue;
    out[i] = { ...link, url: result.pdfUrl };
    const landing = result.landingUrl ?? link.url;
    if (!out.some((other) => other.url === landing)) {
      out.push({ ...link, title: `${link.title} — download page`, url: landing, type: "Other" } as T);
    }
    notes.push(`${hostOf(link.url)}: manual resolved to a PDF on ${hostOf(result.pdfUrl)} (${result.via}, ${result.hops} hop(s))`);
  }
  return { links: out, notes };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(invalid)";
  }
}
