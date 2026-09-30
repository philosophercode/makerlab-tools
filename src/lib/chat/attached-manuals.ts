import type { FilePart, ImagePart, ModelMessage, TextPart, UserModelMessage } from "ai";
import type { MakerLabTool } from "../../components/catalog-types";
import type { ToolResource } from "../data/resources";
import type { AttachedManualLink } from "../manuals/attached-citations";
import { CITE_HREF_PREFIX, documentRefPrefix } from "../manuals/citation-ref";
import { countPages } from "../manuals/page-count";
import { fetchManualPdf, type ManualPdfSource } from "./fetch-manual-pdf";
import { cachedManualPdf } from "./manual-pdf-cache";

/**
 * The manuals the chat attaches to a turn whole (manual text spec §3.6: the
 * fallback for a manual with no searchable text), what the model is told about
 * them, and what the chat is told about them.
 *
 * Out of `app/api/chat/route.ts` so the agent evals (`evals/harness.ts`)
 * attach and describe them exactly as the route does, and capture the same
 * metadata the route streams as `data-manual-links` — which is what the eval's
 * `citations_resolve` check resolves `#cite-<ref>-<page>` against.
 */

export const MAX_PDFS_PER_CHAT = 3;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB ceiling
const PDF_FETCH_UA = "Mozilla/5.0 (compatible; MakerLabBot/1.0)";
const PDF_FETCH_TIMEOUT_MS = 8000;

export interface AttachedManual {
  title: string;
  url: string;
  /**
   * The resource's own link when `url` is its archived copy. The tool page's
   * links come from a cached read that may predate the copy, so "(attached)"
   * matches either.
   */
  sourceUrl?: string;
  /**
   * What the model cites a page of it by — `#cite-<ref>-<page>` — the first
   * eight hex digits of the resource id (amendment 2026-09-28b).
   */
  ref: string;
  /** Pages in the PDF, read from the bytes; null when pdf.js could not tell. */
  pageCount: number | null;
  /** Base64-encoded PDF bytes, present only if the server-side fetch succeeded. */
  data: string;
}

/** A fetched manual: its bytes, base64, and how many pages they hold. */
interface FetchedPdf {
  data: string;
  pageCount: number | null;
}

/**
 * What the route streams to the chat about the attached manuals
 * (`data-manual-links`): each one's title, stored address, ref and page count
 * — never the bytes.
 */
export function attachedManualLinks(manuals: readonly AttachedManual[]): AttachedManualLink[] {
  return manuals.map((m) => ({ title: m.title, url: m.url, ref: m.ref, pageCount: m.pageCount }));
}

function isPdfUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const cleaned = url.split("?")[0].toLowerCase();
  return cleaned.endsWith(".pdf");
}

/**
 * The PDF to attach for one resource: its archived copy in Blob first (the
 * manual archive — it outlives the manufacturer's link, and matches the href
 * the tool's links carry, which keeps "(attached)" honest), then the source
 * link, then an uploaded file. One per resource, so a manual is never attached
 * twice. `ownStore` marks the copies our own uploaders wrote; the source link
 * is the web's, and is fetched through the SSRF guard (`fetch-manual-pdf.ts`).
 */
export function pickPdfSource(resource: ToolResource): ManualPdfSource | null {
  if (resource.archivedUrl) return { url: resource.archivedUrl, ownStore: true };
  if (resource.url && isPdfUrl(resource.url)) return { url: resource.url, ownStore: false };
  const uploaded = resource.fileUrls.find(isPdfUrl);
  return uploaded ? { url: uploaded, ownStore: true } : null;
}

/**
 * Fetch a PDF server-side and return it base64-encoded, so the model receives
 * the bytes rather than a URL its provider may not be able to fetch. Returns
 * null on any failure — a blocked or non-PDF answer included; the manual is
 * then only a link in the prompt, and the chat request carries on without it.
 */
async function fetchPdfAsBase64(title: string, source: ManualPdfSource): Promise<FetchedPdf | null> {
  const fetched = await fetchManualPdf(source, {
    maxBytes: MAX_PDF_BYTES,
    timeoutMs: PDF_FETCH_TIMEOUT_MS,
    userAgent: PDF_FETCH_UA,
  });
  if (!fetched.ok) {
    console.warn("[chat] PDF not attached:", title, source.url, fetched.reason);
    return null;
  }
  // Counted once per fetch (the cache keeps it beside the bytes): the chat
  // links a cited page only when the PDF has it.
  const pageCount = await countPages(fetched.bytes);
  return { data: Buffer.from(fetched.bytes).toString("base64"), pageCount };
}

/**
 * Fetch the manuals to attach: every PDF resource that is not searchable, up to
 * {@link MAX_PDFS_PER_CHAT}, in resource order. They are fetched in parallel —
 * one wave of up to the cap, then another only to replace failures — rather
 * than one after another (performance plan, quick win 8), and a PDF fetched in
 * the last few minutes comes from memory (`manual-pdf-cache.ts`).
 */
export async function collectToolManuals(
  forTool: ToolResource[],
  searchableResourceIds: ReadonlySet<string> = new Set()
): Promise<{ manuals: AttachedManual[]; skipped: number }> {
  const candidates: { resource: ToolResource; source: ManualPdfSource }[] = [];
  // The addresses of the searchable manuals: another resource linking the
  // same PDF (the Form 4's "SOP" is its manual's manufacturer link) is the same
  // document, answered by `search_manual` — attaching it too would leave the
  // model a second, uncitable copy to quote from.
  const searchableUrls = new Set(
    forTool
      .filter((r) => searchableResourceIds.has(r.id))
      .flatMap((r) => [r.url, r.archivedUrl, ...r.fileUrls])
      .filter((url): url is string => Boolean(url))
  );
  for (const r of forTool) {
    // Searchable: `search_manual` reads it page by page — never attached, and
    // never counted against MAX_PDFS_PER_CHAT.
    if (searchableResourceIds.has(r.id)) continue;
    if ((r.url && searchableUrls.has(r.url)) || (r.archivedUrl && searchableUrls.has(r.archivedUrl))) {
      console.info(`[chat] not attaching ${r.title}: the same PDF is searchable`);
      continue;
    }
    const source = pickPdfSource(r);
    if (!source) {
      if (r.url) {
        console.info(`[chat] skipping non-PDF resource: ${r.title} (${r.url})`);
      }
      continue;
    }
    candidates.push({ resource: r, source });
  }

  const manuals: AttachedManual[] = [];
  let skipped = 0;
  try {
    let next = 0;
    while (manuals.length < MAX_PDFS_PER_CHAT && next < candidates.length) {
      const wave = candidates.slice(next, next + (MAX_PDFS_PER_CHAT - manuals.length));
      next += wave.length;
      const fetched = await Promise.all(
        wave.map(({ resource, source }) =>
          cachedManualPdf(source.url, () => fetchPdfAsBase64(resource.title || "Manual", source))
        )
      );
      wave.forEach(({ resource: r, source: { url } }, index) => {
        const pdf = fetched[index];
        if (!pdf) {
          skipped += 1;
          return;
        }
        const title = r.title || "Manual";
        const { data, pageCount } = pdf;
        const ref = documentRefPrefix(r.id);
        manuals.push(
          r.archivedUrl && r.url && url === r.archivedUrl
            ? { title, url, sourceUrl: r.url, ref, pageCount, data }
            : { title, url, ref, pageCount, data }
        );
      });
    }
    for (const { resource } of candidates.slice(next)) {
      console.info(`[chat] PDF cap reached (${MAX_PDFS_PER_CHAT}); skipping: ${resource.title}`);
    }
  } catch (err) {
    // Never let base64 collection take down the request; the manuals stay links.
    console.warn("[chat] manual collection failed; manuals stay links only", err);
    return { manuals: [], skipped: skipped + manuals.length };
  }
  return { manuals, skipped };
}

export function attachManualsToFirstUserMessage(
  messages: ModelMessage[],
  manuals: AttachedManual[]
): ModelMessage[] {
  if (manuals.length === 0) return messages;
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) return messages;

  const fileParts: FilePart[] = manuals.map((m) => ({
    type: "file",
    mediaType: "application/pdf",
    // Base64 of bytes we fetched server-side — avoids handing the provider a
    // URL it can't fetch (hosts that block its fetcher answer with an error).
    // A plain file part, with no provider options: every Gateway model reads
    // it, and caching repeated context is the provider's own (spec §3.4).
    data: m.data,
    filename: `${m.title}.pdf`,
  }));

  const target = messages[firstUserIdx] as UserModelMessage;
  const existing = target.content;
  const existingParts: (TextPart | FilePart | ImagePart)[] = Array.isArray(existing)
    ? (existing.filter(
        (p) => p.type === "text" || p.type === "file" || p.type === "image"
      ) as (TextPart | FilePart | ImagePart)[])
    : [{ type: "text", text: String(existing ?? "") }];

  const updated: UserModelMessage = {
    role: "user",
    content: [...fileParts, ...existingParts],
  };
  return [
    ...messages.slice(0, firstUserIdx),
    updated,
    ...messages.slice(firstUserIdx + 1),
  ];
}

/**
 * Append the per-request manual sections to the composed system prompt. These
 * depend on the server-side PDF fetch for the focused tool, so they live
 * outside the surface-agnostic chat adapter (which only knows the
 * catalog/focused-tool/locale env). When no manuals were attached this is a
 * no-op and the adapter's prompt is returned unchanged.
 */
export function appendManualSections(
  system: string,
  focused: MakerLabTool | null,
  manuals: AttachedManual[]
): string {
  if (manuals.length === 0) return system;

  const sections: string[] = [system];

  const list = manuals
    .map((m) => `- **${m.title}** — ref \`${m.ref}\`${m.pageCount ? `, ${m.pageCount} pages` : ""}`)
    .join("\n");
  const example = manuals[0];
  sections.push(
    `## Available manuals\n\nThe following PDF manuals are attached to this conversation as documents — read both their text and figures directly:\n\n${list}\n\nCite every fact you take from one with its page, as a markdown link whose address is \`${CITE_HREF_PREFIX}\` followed by the manual's \`ref\`, a hyphen and the PDF page number (counting the file's pages from 1, not the number printed on the page), with the manual's title and page in the linked words: e.g. [Loading filament (${example.title}, p. 12)](${CITE_HREF_PREFIX}${example.ref}-12). The chat turns that into the link that opens the manual at that page. Never write a manual's web address, a PDF link or a \`#page=\` link yourself.`
  );

  if (focused && focused.links.length > 0) {
    const attachedUrls = new Set(manuals.flatMap((m) => (m.sourceUrl ? [m.url, m.sourceUrl] : [m.url])));
    const annotated = focused.links
      .map((link) => {
        const tag = attachedUrls.has(link.href) ? " (attached)" : "";
        return `- [${link.kind || "Resource"}] ${link.label} — ${link.href}${tag}`;
      })
      .join("\n");
    sections.push(
      `## Attached manuals vs. readable resources\n\nItems marked "(attached)" below are already inlined above as PDF documents — read them directly; do not call \`read_page\` on them. For a web page among the other links, call \`read_page\` on its exact URL when the answer needs it. \`read_page\` does not read PDFs: for a PDF that is not attached, give the student the link rather than guessing what it says.\n\n${annotated}`
    );
  }

  return sections.join("\n\n");
}
