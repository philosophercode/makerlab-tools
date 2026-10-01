/**
 * Citation references (manual text spec amendment 2026-09-28 "Citations always
 * resolve").
 *
 * A manual citation's address is never typed by the model. `search_manual`
 * gives every passage a short `ref` — the first eight hex digits of its
 * document id and its first page, e.g. `3f2a9c10-42` — and the chat prompt has
 * the model cite with a link to `#cite-<ref>`. The chat turns that back into
 * the passage's `url`, which the tool built from the attachment's stored
 * address when it ran. A ref the model garbles matches nothing and is drawn as
 * plain text; nothing the model wrote ever becomes the link.
 *
 * Pure, no imports: the capability, the chat UI and the eval checker share it.
 */

/** What a citation link's address starts with. */
export const CITE_HREF_PREFIX = "#cite-";

/** A passage's ref: `<first 8 hex of the document id>-<first page>`. */
export function citationRef(documentId: string, pageStart: number): string {
  return `${documentRefPrefix(documentId)}-${Math.max(1, Math.trunc(pageStart))}`;
}

/**
 * The part of a ref that names the document: the first eight hex digits of an
 * id. A manual the chat attached whole is cited as `#cite-<its prefix>-<page>`
 * (amendment 2026-09-28b "Attached manuals cite pages too"), the prefix taken
 * from its resource id by the route.
 */
export function documentRefPrefix(id: string): string {
  return id.replace(/[^0-9a-f]/gi, "").slice(0, 8).toLowerCase() || "doc";
}

/**
 * Where `text` first links to `href` as Markdown (`](href)`), ignoring case,
 * or -1. The one test for "the answer cited this passage": the chat's Sources
 * (`components/chat/manual-citations.ts`) and Usage Insight's `manual_cited`
 * (`lib/usage/from-turn.ts`) both use it, by `#cite-<ref>` and by exact URL.
 */
export function linkPosition(text: string, href: string): number {
  return text.toLowerCase().indexOf(`](${href.toLowerCase()})`);
}

/** `#cite-3f2a9c10-42` → `3f2a9c10-42`; anything else → null. */
export function refFromHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.toLowerCase().startsWith(CITE_HREF_PREFIX)) return null;
  const ref = trimmed.slice(CITE_HREF_PREFIX.length).trim().toLowerCase();
  return /^[0-9a-z]{1,16}-\d{1,5}$/.test(ref) ? ref : null;
}

/**
 * Whether a link's address looks like a manual citation — a PDF, a page
 * anchor, a file in a Blob store or the local store, or a `#cite-` ref — the
 * kind of link the chat only draws when a tool returned it.
 */
export function isCitationLikeHref(href: string): boolean {
  const trimmed = href.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase().startsWith(CITE_HREF_PREFIX)) return true;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    // Not a URL at all — `https://…/manual.pdf#page=42`, a placeholder copied
    // from an example — but still written to look like a manual page.
    return /^https?:\/\//i.test(trimmed) && /\.pdf\b|#page=\d/i.test(trimmed);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (/(^|&)page=\d+/i.test(url.hash.slice(1))) return true;
  if (url.pathname.toLowerCase().endsWith(".pdf")) return true;
  if (url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")) return true;
  return url.pathname.startsWith("/api/dev-blob/");
}

/** `https://x/m.pdf#page=42` → 42; no page anchor → null. */
export function pageFromUrl(href: string): number | null {
  const hash = href.split("#")[1] ?? "";
  const match = /(?:^|&)page=(\d{1,5})/i.exec(hash);
  return match ? Number(match[1]) : null;
}

/** The address without its fragment. */
export function withoutFragment(href: string): string {
  return href.split("#")[0];
}
