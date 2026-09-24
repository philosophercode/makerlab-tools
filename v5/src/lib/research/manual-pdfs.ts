import type { SearchPageText } from "../ai/exa.ts";
import { isBrandHost, type PageSubject } from "./source-pages.ts";

/**
 * Manual PDFs the search saw but did not choose (manual text spec §3.7).
 *
 * In the live X2D run the real manual — a PDF on Bambu Lab's CDN,
 * `csm.bblcdn.cn/hub/<hash>.pdf` — was among Exa's results, with its text, but
 * the search model listed the documentation *page* as the manual instead, so
 * the read step never opened the PDF. Now that research extracts a manual's
 * text itself, a manual PDF anywhere in the results is worth one of the four
 * reads:
 *
 * - {@link pickManualPdfs} — the search results whose URL is a `.pdf` and
 *   whose title or text names this model (a model word such as "x2d", else the
 *   brand), best first.
 * - {@link withManualPdf} — the read list with one of them in it when the list
 *   holds no PDF already: appended when there is room, else in place of the
 *   last page that is not the product page (a video first).
 *
 * The URL's host is not required to be the brand's — a manufacturer's CDN
 * rarely is — which is why the model must be named in what Exa captured. The
 * PDF is still read through the SSRF guard and fenced as untrusted text.
 *
 * Pure. Plain Node: step code imports it.
 */

/** At most this many cross the step boundary. */
export const MAX_MANUAL_PDFS_CARRIED = 2;

export function isPdfUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.pathname.toLowerCase().endsWith(".pdf");
  } catch {
    return false;
  }
}

/** Words of the name that identify a model: a letter and a digit, not the brand ("x2d", "mk4s", "form-4"). */
export function modelWords(subject: PageSubject): string[] {
  const brand = (subject.brand ?? "").toLowerCase();
  return [
    ...new Set(
      (subject.name ?? "")
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((word) => word.length >= 2 && /\d/.test(word) && /[a-z]/.test(word) && !brand.includes(word))
    ),
  ];
}

/** How strongly a result names the subject: 2 a model word, 1 the brand only, 0 neither. */
function relevance(result: SearchPageText, subject: PageSubject): number {
  const haystack = `${result.url}\n${result.title ?? ""}\n${result.text.slice(0, 4000)}`.toLowerCase();
  const models = modelWords(subject);
  if (models.some((word) => new RegExp(`(^|[^a-z0-9])${escape(word)}([^a-z0-9]|$)`).test(haystack))) return 2;
  const brand = (subject.brand ?? "").trim().toLowerCase();
  if (models.length === 0 && brand && (haystack.includes(brand) || hostIsBrand(result.url, subject.brand))) return 1;
  return 0;
}

function hostIsBrand(url: string, brand: string | null | undefined): boolean {
  try {
    return isBrandHost(new URL(url).hostname, brand);
  } catch {
    return false;
  }
}

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The search results that look like this model's manual PDF, best first, at most {@link MAX_MANUAL_PDFS_CARRIED}. */
export function pickManualPdfs(results: readonly SearchPageText[], subject: PageSubject): string[] {
  return results
    .filter((result) => isPdfUrl(result.url))
    .map((result, index) => ({ url: result.url, index, score: relevance(result, subject) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_MANUAL_PDFS_CARRIED)
    .map((entry) => entry.url);
}

/**
 * `urls` with the first of `manualPdfs` in it, when `urls` has no PDF yet. The
 * first URL (the product page, when the search found one) is never displaced.
 */
export function withManualPdf(urls: readonly string[], manualPdfs: readonly string[], max: number): string[] {
  const list = [...urls];
  if (list.some(isPdfUrl)) return list;
  const pdf = manualPdfs.find((url) => !list.includes(url));
  if (!pdf || max <= 0) return list;
  if (list.length < max) return [...list, pdf];
  if (list.length <= 1) return list;
  const videoAt = findLastIndex(list, (url, i) => i > 0 && /youtube\.com|youtu\.be|vimeo\.com/i.test(url));
  const at = videoAt > 0 ? videoAt : list.length - 1;
  list[at] = pdf;
  return list;
}

function findLastIndex<T>(list: readonly T[], test: (item: T, index: number) => boolean): number {
  for (let i = list.length - 1; i >= 0; i -= 1) if (test(list[i], i)) return i;
  return -1;
}
