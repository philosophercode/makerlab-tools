import { CITE_HREF_PREFIX } from "./citation-ref.ts";

/**
 * Page citations of a manual the chat attached whole (manual text spec
 * amendment 2026-09-28b "Attached manuals cite pages too").
 *
 * A manual with no searchable text is attached to the turn as a PDF; the route
 * streams its stored address, a `ref` (the first eight hex digits of its
 * resource id) and its page count as `data-manual-links`. The model cites a
 * page of it as `#cite-<ref>-<page>`, or — the older form — as plain text
 * "(<exact title>, p. N)". The chat (`components/chat/manual-citations.ts`)
 * and the eval's citation check (`citation-check.ts`) both read those forms
 * with the helpers here, so they cannot drift apart.
 *
 * Pure, no I/O.
 */

/** A manual the route attached whole to a turn, as `data-manual-links` carries it. */
export interface AttachedManualLink {
  title: string;
  /** Its stored address, without a fragment. */
  url: string;
  /** What its pages are cited by (`#cite-<ref>-<page>`); empty on a part streamed before refs existed. */
  ref: string;
  /** Pages in the PDF, or null when the route could not tell. */
  pageCount: number | null;
}

/** Whether `page` may be cited in `manual`: a whole page number within its page count, when known. */
export function attachedManualHasPage(manual: AttachedManualLink, page: number): boolean {
  return Number.isInteger(page) && page >= 1 && (manual.pageCount === null || page <= manual.pageCount);
}

/** `text` as a literal inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface LinkMentionOptions {
  /**
   * Link a mention only at a page the PDF has (the chat's rule: an
   * out-of-range page stays plain words). The eval's check turns every
   * mention into a link so it can report the out-of-range page. Default true.
   */
  onlyPagesItHas?: boolean;
}

/**
 * Turn a page reference to an attached manual that the model wrote as plain
 * text — "(Bambu Lab X1-Carbon Combo 3D Printer - SOP, p. 8)" — into a
 * `#cite-` link. Only the route's exact title is recognised, and never inside
 * a link's words.
 */
export function linkAttachedPageMentions(
  text: string,
  manuals: readonly AttachedManualLink[],
  { onlyPagesItHas = true }: LinkMentionOptions = {}
): string {
  let out = text;
  const titled = manuals.filter((m) => m.ref && m.title.trim()).sort((a, b) => b.title.length - a.title.length);
  for (const manual of titled) {
    const pattern = new RegExp(`${escapeRegExp(manual.title.trim())},\\s*pp?\\.\\s*(\\d{1,5})(?:\\s*[–-]\\s*\\d{1,5})?`, "g");
    out = out.replace(pattern, (match: string, page: string, offset: number, whole: string) => {
      // Already the words of a link: leave it to the link.
      if (/^[^[\]\n]*\]\(/.test(whole.slice(offset + match.length))) return match;
      if (onlyPagesItHas && !attachedManualHasPage(manual, Number(page))) return match;
      return `[${match}](${CITE_HREF_PREFIX}${manual.ref}-${Number(page)})`;
    });
  }
  return out;
}

/**
 * The attached manual and page a `#cite-<ref>-<page>` address names, or null
 * when no attached manual has that ref. The page is returned as written — the
 * caller decides whether the PDF has it.
 */
export function attachedCiteTarget(
  href: string,
  manuals: readonly AttachedManualLink[]
): { manual: AttachedManualLink; page: number } | null {
  const trimmed = href.trim().toLowerCase();
  if (!trimmed.startsWith(CITE_HREF_PREFIX)) return null;
  const match = /^([0-9a-z]{1,16})-(\d{1,5})$/.exec(trimmed.slice(CITE_HREF_PREFIX.length));
  if (!match) return null;
  const manual = manuals.find((m) => m.ref && m.ref.toLowerCase() === match[1]);
  return manual ? { manual, page: Number(match[2]) } : null;
}
