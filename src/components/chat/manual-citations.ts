import { CITE_HREF_PREFIX, isCitationLikeHref, withoutFragment } from "../../lib/manuals/citation-ref";
import {
  attachedManualHasPage as hasPage,
  escapeRegExp,
  linkAttachedPageMentions,
  type AttachedManualLink,
} from "../../lib/manuals/attached-citations";

export { linkAttachedPageMentions, type AttachedManualLink };

/**
 * Manual citations in an answer (UI system spec §9.1, phase 5b; manual text
 * spec amendment 2026-09-28 "Citations always resolve").
 *
 * `search_manual` builds every passage's `citation` ("Form 4 Manual, p. 42"),
 * a `url` that opens the stored PDF at that page and a short `ref`, and its
 * prompt has the model cite a fact as a Markdown link to `#cite-<ref>`
 * (capabilities/manuals.ts). The call's output streams to the browser as the
 * tool part's `output`, so the chat can draw those links for what they are: a
 * link to one of this message's refs — or, as before, to one of its passage
 * URLs exactly — is a citation, drawn inline with its page and opening the
 * **tool's** URL; the passages the answer linked are its `Sources`.
 *
 * **Only a tool's address becomes a manual link** ({@link classifyLink}).
 * Nothing is inferred from the link text, and a manual-looking address the
 * model wrote itself — a PDF, a `#page=` anchor, a Blob URL, a ref that
 * matches nothing — is drawn as plain words, marked unverified, never as a
 * link: that is where the broken and invented citations came from. The one
 * other source is the route's `data-manual-links` part: the manuals it
 * attached whole, each with its stored address, a `ref` and its page count.
 * A page of one cited as `#cite-<ref>-<page>` (or written as plain
 * "(<title>, p. N)") is a citation opening the **stored** address at that
 * page, when the PDF has it (amendment 2026-09-28b "Attached manuals cite
 * pages too"); the model supplies the page number and nothing else.
 */

export interface ManualPassageRef {
  /** `3f2a9c10-42` — what the model links as `#cite-<ref>`. */
  ref: string;
  /** "Form 4 Manual, p. 42" — built by the tool, not the model. */
  citation: string;
  /** Opens the PDF at the page. */
  url: string;
  /** "Maintenance › Resin tank", or empty. */
  section: string;
  /** The passage's words, unfenced and shortened, or empty. */
  excerpt: string;
}

interface SearchManualOutput {
  status?: unknown;
  passages?: unknown;
}

const EXCERPT_MAX = 280;

/**
 * Every passage with a URL that this message's finished `search_manual` calls
 * returned, keyed by its URL **and** by `#cite-<ref>` (both keys, one object).
 */
export function manualPassages(parts: readonly { type: string }[]): Map<string, ManualPassageRef> {
  const byKey = new Map<string, ManualPassageRef>();
  for (const part of parts) {
    if (part.type !== "tool-search_manual") continue;
    const { state, output } = part as { state?: string; output?: SearchManualOutput };
    if (state !== "output-available" || !output || output.status !== "ok" || !Array.isArray(output.passages)) continue;
    for (const raw of output.passages as Array<Record<string, unknown>>) {
      const url = typeof raw?.url === "string" ? raw.url.trim() : "";
      const citation = typeof raw?.citation === "string" ? raw.citation.trim() : "";
      const ref = typeof raw?.ref === "string" ? raw.ref.trim().toLowerCase() : "";
      if (!url || !citation) continue;
      const passage: ManualPassageRef = byKey.get(url) ?? {
        ref,
        citation,
        url,
        section: typeof raw.section === "string" ? raw.section : "",
        excerpt: typeof raw.text === "string" ? passageExcerpt(raw.text) : "",
      };
      if (!byKey.has(url)) byKey.set(url, passage);
      if (ref && !byKey.has(`${CITE_HREF_PREFIX}${ref}`)) byKey.set(`${CITE_HREF_PREFIX}${ref}`, passage);
    }
  }
  // The attached manuals' pages the answer cites (amendment 2026-09-28b). A
  // search's passage keeps its key.
  for (const [key, passage] of attachedPassages(parts, attachedManuals(parts))) {
    if (!byKey.has(key)) byKey.set(key, passage);
  }
  return byKey;
}

/** The manuals the route attached whole to this turn, each once, in order. */
export function attachedManuals(parts: readonly { type: string }[]): AttachedManualLink[] {
  const byUrl = new Map<string, AttachedManualLink>();
  for (const part of parts) {
    if (part.type !== "data-manual-links") continue;
    const data = (part as { data?: { kind?: unknown; links?: unknown } }).data;
    if (data?.kind !== "manual-links" || !Array.isArray(data.links)) continue;
    for (const link of data.links as Array<Record<string, unknown>>) {
      const url = typeof link?.url === "string" ? withoutFragment(link.url.trim()) : "";
      if (!url || byUrl.has(url)) continue;
      const ref = typeof link.ref === "string" && /^[0-9a-z]{1,16}$/.test(link.ref) ? link.ref : "";
      const pageCount = typeof link.pageCount === "number" && Number.isInteger(link.pageCount) && link.pageCount > 0 ? link.pageCount : null;
      byUrl.set(url, { title: typeof link.title === "string" ? link.title : "", url, ref, pageCount });
    }
  }
  return [...byUrl.values()];
}

/**
 * The attached manuals by their stored address without a fragment: a
 * document the model may link. A link to one at a page is a citation when
 * that page is one the PDF has ({@link manualPassages}); otherwise the whole
 * document.
 */
export function attachedManualLinks(parts: readonly { type: string }[]): Map<string, string> {
  return new Map(attachedManuals(parts).map((manual) => [manual.url, manual.title]));
}

/**
 * A page of an attached manual as a passage: the citation is the route's
 * title and the page, and the URL is the **stored** address with `#page=N` —
 * the model supplies only the number, and only one the PDF has.
 */
export function attachedPagePassage(manual: AttachedManualLink, page: number): ManualPassageRef | null {
  if (!hasPage(manual, page)) return null;
  return {
    ref: manual.ref ? `${manual.ref}-${page}` : "",
    citation: `${manual.title}, p. ${page}`,
    url: `${manual.url}#page=${page}`,
    section: "",
    excerpt: "",
  };
}

/**
 * The attached manuals' pages this message's text links — `#cite-<ref>-<page>`
 * or the stored address with `#page=N` — as passages keyed the way
 * {@link manualPassages} keys a search's.
 */
function attachedPassages(parts: readonly { type: string }[], manuals: readonly AttachedManualLink[]): Map<string, ManualPassageRef> {
  const byKey = new Map<string, ManualPassageRef>();
  if (manuals.length === 0) return byKey;
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => linkAttachedPageMentions(String((part as { text?: unknown }).text ?? ""), manuals))
    .join("\n");
  const add = (manual: AttachedManualLink, page: number) => {
    const passage = attachedPagePassage(manual, page);
    if (!passage) return;
    if (!byKey.has(passage.url)) byKey.set(passage.url, passage);
    const shared = byKey.get(passage.url)!;
    if (passage.ref) byKey.set(`${CITE_HREF_PREFIX}${passage.ref}`, shared);
  };
  for (const manual of manuals) {
    if (manual.ref) {
      const cite = new RegExp(`${escapeRegExp(CITE_HREF_PREFIX + manual.ref)}-(\\d{1,5})\\b`, "gi");
      for (const match of text.matchAll(cite)) add(manual, Number(match[1]));
    }
    const anchored = new RegExp(`${escapeRegExp(manual.url)}#page=(\\d{1,5})\\b`, "g");
    for (const match of text.matchAll(anchored)) add(manual, Number(match[1]));
  }
  return byKey;
}

/** What one link in an answer is, and so how it is drawn. */
export type LinkKind =
  | { kind: "citation"; passage: ManualPassageRef }
  | { kind: "document"; url: string; title: string }
  | { kind: "internal"; href: string }
  | { kind: "unverified" }
  | { kind: "external"; href: string };

/**
 * Decide what a link the model wrote may be (see the module comment): a
 * passage's ref or exact URL is a citation; an attached manual's own address
 * (any `#page=` the model added dropped) is a document; a site path is
 * internal; any other manual-looking address is unverified and drawn as
 * text; everything else is an ordinary external link.
 */
export function classifyLink(
  href: string,
  passages: ReadonlyMap<string, ManualPassageRef>,
  documents: ReadonlyMap<string, string> = new Map()
): LinkKind {
  const target = href.trim();
  const passage = passages.get(target) ?? passages.get(target.toLowerCase());
  if (passage) return { kind: "citation", passage };
  if (target.startsWith("/") && !target.startsWith("//")) return { kind: "internal", href: target };
  const document = documents.get(withoutFragment(target));
  if (document !== undefined) return { kind: "document", url: withoutFragment(target), title: document };
  if (isCitationLikeHref(target)) return { kind: "unverified" };
  return { kind: "external", href: target };
}

/** The passages a text links to (by ref or URL), in the order it first links them. */
export function citedPassages(text: string, passages: ReadonlyMap<string, ManualPassageRef>): ManualPassageRef[] {
  if (passages.size === 0) return [];
  const found = new Map<ManualPassageRef, number>();
  for (const [key, passage] of passages) {
    const at = text.toLowerCase().indexOf(`](${key.toLowerCase()})`);
    if (at < 0) continue;
    const seen = found.get(passage);
    if (seen === undefined || at < seen) found.set(passage, at);
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([passage]) => passage);
}

/** "Form 4 Manual, pp. 44–45 (printed 3-12)" → "pp. 44–45": the part a reader scans for. */
export function pageMark(citation: string): string {
  const match = citation.match(/\bpp?\. [^,()]+?(?=\s*(?:\(|$))/);
  return match ? match[0].trim() : citation;
}

/**
 * The linked words without the citation the model was told to repeat in them:
 * "Replacing the resin tank (Form 4 Manual, p. 42)" → "Replacing the resin
 * tank", since the mark after it says the page. Words that are nothing but
 * the citation keep the manual's name ("Form 4 Manual").
 *
 * **Any** "(<document>, p. N)" the model wrote is dropped, not only the exact
 * citation: the only document name and page drawn for a citation are the
 * passage's own (the mark, the card, Sources), from the same
 * `manual_documents` row as the URL — so words naming another document ("SOP,
 * p. 9" over a link to the quick-start guide) can never label the link
 * (manual text spec amendment 2026-09-28). Words that are only a citation
 * become the passage's document title.
 */
export function citationPhrase(words: string, citation: string): string {
  const text = words.trim();
  const title = citation.replace(/,\s*pp?\. .*$/, "");
  if (text === citation) return title;
  const withoutParenthetical = text.replace(/\s*\([^()]*,\s*pp?\.\s*\d[^()]*(?:\([^()]*\))?[^()]*\)\s*$/, "").trim();
  if (withoutParenthetical !== text) return withoutParenthetical || title;
  if (/^[^()]*,\s*pp?\.\s*\d/.test(text)) return title;
  return words;
}

/**
 * The words of a link to an attached manual, without any "(<document>, p. N)"
 * the model put in them: the link opens the whole document, not a page, and
 * is named by the route's title for it (the link's `title`).
 */
export function documentPhrase(words: string, title: string): string {
  return citationPhrase(words, `${title}, p. 0`);
}

/**
 * The words of a fenced passage (`web/fence.ts`): the opening marker and its
 * one-line preamble and the closing marker removed, whitespace folded, cut to
 * a readable length. Shown as plain text, never as Markdown or HTML.
 */
export function passageExcerpt(fenced: string): string {
  const lines = fenced.split("\n");
  const body =
    lines.length >= 3 && /^<untrusted-page\b/.test(lines[0]) && /^<\/untrusted-page\b/.test(lines[lines.length - 1])
      ? lines.slice(2, -1).join(" ")
      : fenced.replace(/<\/?untrusted-page\b[^>]*>/g, " ");
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
}
